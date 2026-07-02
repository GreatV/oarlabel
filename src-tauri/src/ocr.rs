//! OCR / layout inference. Pipelines are expensive to build, so each selected
//! model/device pair is built once and cached.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(feature = "cuda")]
use oar_ocr::core::config::OrtExecutionProvider;
use oar_ocr::core::config::OrtSessionConfig;
use oar_ocr::domain::tasks::layout_detection::LayoutDetectionConfig;
use oar_ocr::domain::tasks::TextDetectionConfig;
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};
use oar_ocr::predictors::{
    FormulaRecognitionPredictor, LayoutDetectionPredictor, TableStructureRecognitionPredictor,
};
use oar_ocr::utils::load_image;
use serde::Serialize;
use tauri::AppHandle;

use crate::models;

#[derive(Serialize)]
pub struct PreannBox {
    pub points: Vec<[f32; 2]>,
    pub text: Option<String>,
    pub label: Option<String>,
    pub score: Option<f32>,
}

static OCR: OnceLock<Mutex<HashMap<String, Arc<OAROCR>>>> = OnceLock::new();
static LAYOUT: OnceLock<Mutex<HashMap<String, Arc<LayoutDetectionPredictor>>>> = OnceLock::new();
static FORMULA: OnceLock<Mutex<HashMap<String, Arc<FormulaRecognitionPredictor>>>> =
    OnceLock::new();
static TABLE: OnceLock<Mutex<HashMap<String, Arc<TableStructureRecognitionPredictor>>>> =
    OnceLock::new();

fn ort_config_for(device: &str) -> Result<Option<OrtSessionConfig>, String> {
    let d = device.to_lowercase();
    if d.is_empty() || d == "cpu" || d == "auto" {
        return Ok(None);
    }

    #[cfg(feature = "cuda")]
    {
        if d.starts_with("cuda") {
            let device_id = if d == "cuda" {
                0
            } else if let Some(id) = d.strip_prefix("cuda:") {
                id.parse::<i32>()
                    .map_err(|_| format!("无效的 CUDA 设备号: {device}"))?
            } else {
                return Err(format!("无效的设备格式: {device}，应为 'cuda' 或 'cuda:N'"));
            };
            let cfg = OrtSessionConfig::new().with_execution_providers(vec![
                OrtExecutionProvider::CUDA {
                    device_id: Some(device_id),
                    gpu_mem_limit: None,
                    arena_extend_strategy: None,
                    cudnn_conv_algo_search: None,
                    cudnn_conv_use_max_workspace: None,
                },
                OrtExecutionProvider::CPU,
            ]);
            return Ok(Some(cfg));
        }
    }

    #[cfg(not(feature = "cuda"))]
    {
        if d.starts_with("cuda") {
            return Err(
                "已选择 CUDA，但当前版本未启用 CUDA 支持。请改用 CPU，或使用 `cargo build --features cuda` 重新构建。"
                    .into(),
            );
        }
    }

    Err(format!("不支持的设备: {device}，支持 cpu / auto"))
}

fn get_or_build_ocr(
    app: &AppHandle,
    profile_key: &str,
    device: &str,
) -> Result<Arc<OAROCR>, String> {
    let cache_key = format!("{profile_key}|{device}");
    let cell = OCR.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing.clone());
    }

    let prof = models::profile(app, profile_key)?;
    let det = models::resolve(app, &prof.det)
        .ok_or_else(|| format!("缺少文本检测模型 ({})，请在模型参数设置中下载", prof.det))?;
    let rec = models::resolve(app, &prof.rec)
        .ok_or_else(|| format!("缺少文本识别模型 ({})，请在模型参数设置中下载", prof.rec))?;
    let dict =
        models::resolve(app, &prof.dict).ok_or_else(|| format!("缺少字典文件 ({})", prof.dict))?;

    let mut builder = OAROCRBuilder::new(&det, &rec, &dict);
    if profile_key.starts_with("ppocrv6_") {
        builder = builder.text_detection_config(TextDetectionConfig {
            score_threshold: 0.2,
            box_threshold: 0.45,
            unclip_ratio: 1.4,
            ..Default::default()
        });
    }
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.ort_session(cfg);
    }
    let ocr = builder
        .build()
        .map_err(|e| format!("构建 OCR 流水线失败: {e}"))?;
    let arc = Arc::new(ocr);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

fn get_or_build_layout(
    app: &AppHandle,
    layout_key: &str,
    device: &str,
) -> Result<Arc<LayoutDetectionPredictor>, String> {
    let cache_key = format!("{layout_key}|{device}");
    let cell = LAYOUT.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing.clone());
    }

    let d = models::def(app, layout_key).and_then(|d| {
        if d.kind == models::ModelKind::Layout {
            Ok(d)
        } else {
            Err(format!("不是版面检测模型: {layout_key}"))
        }
    })?;
    let model = models::resolve(app, layout_key)
        .ok_or_else(|| format!("缺少版面检测模型 ({})，请在模型参数设置中下载", d.title))?;
    let model_name = d
        .pipeline_name
        .ok_or_else(|| format!("版面检测模型缺少 pipeline_name: {layout_key}"))?;

    let mut builder = LayoutDetectionPredictor::builder()
        .with_config(LayoutDetectionConfig::default())
        .model_name(model_name);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&model)
        .map_err(|e| format!("构建版面检测器失败: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

fn get_or_build_formula(
    app: &AppHandle,
    formula_key: &str,
    device: &str,
) -> Result<Arc<FormulaRecognitionPredictor>, String> {
    let cache_key = format!("{formula_key}|{device}");
    let cell = FORMULA.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing.clone());
    }

    let prof = models::formula_profile(app, formula_key)?;
    let model = models::resolve(app, &prof.model)
        .ok_or_else(|| format!("缺少公式识别模型 ({})，请在模型参数设置中下载", prof.title))?;
    let tokenizer = models::resolve(app, &prof.tokenizer).ok_or_else(|| {
        format!(
            "缺少公式识别 tokenizer ({})，请在模型参数设置中下载",
            prof.title
        )
    })?;

    let mut builder = FormulaRecognitionPredictor::builder()
        .model_name(&prof.model_name)
        .tokenizer_path(&tokenizer);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&model)
        .map_err(|e| format!("构建公式识别器失败: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

fn get_or_build_table(
    app: &AppHandle,
    table_key: &str,
    device: &str,
) -> Result<Arc<TableStructureRecognitionPredictor>, String> {
    let cache_key = format!("{table_key}|{device}");
    let cell = TABLE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing.clone());
    }

    let prof = models::table_profile(app, table_key)?;
    let model = models::resolve(app, &prof.structure)
        .ok_or_else(|| format!("缺少表格识别模型 ({})，请在模型参数设置中下载", prof.title))?;
    let dict = models::resolve(app, &prof.dict)
        .ok_or_else(|| format!("缺少表格结构字典 ({})，请在模型参数设置中下载", prof.title))?;

    let mut builder = TableStructureRecognitionPredictor::builder()
        .model_name(&prof.model_name)
        .dict_path(&dict);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&model)
        .map_err(|e| format!("构建表格识别器失败: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

fn crop_region(image: &image::RgbImage, points: &[[f32; 2]]) -> Result<image::RgbImage, String> {
    if points.is_empty() {
        return Err("识别区域没有坐标点".into());
    }
    let x_min = points.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min);
    let y_min = points.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
    let x_max = points
        .iter()
        .map(|p| p[0])
        .fold(f32::NEG_INFINITY, f32::max);
    let y_max = points
        .iter()
        .map(|p| p[1])
        .fold(f32::NEG_INFINITY, f32::max);
    if !x_min.is_finite()
        || !y_min.is_finite()
        || !x_max.is_finite()
        || !y_max.is_finite()
        || x_max <= x_min
        || y_max <= y_min
    {
        return Err("识别区域坐标无效".into());
    }

    let image_width = image.width() as f32;
    let image_height = image.height() as f32;
    let x0 = x_min.floor().clamp(0.0, image_width) as u32;
    let y0 = y_min.floor().clamp(0.0, image_height) as u32;
    let x1 = x_max.ceil().clamp(0.0, image_width) as u32;
    let y1 = y_max.ceil().clamp(0.0, image_height) as u32;
    if x1 <= x0 || y1 <= y0 {
        return Err("识别区域超出图像范围".into());
    }

    Ok(image::imageops::crop_imm(image, x0, y0, x1 - x0, y1 - y0).to_image())
}

pub fn run_ocr(
    app: &AppHandle,
    image_path: &str,
    profile_key: &str,
    device: &str,
) -> Result<Vec<PreannBox>, String> {
    let ocr = get_or_build_ocr(app, profile_key, device)?;
    let img = load_image(Path::new(image_path)).map_err(|e| format!("加载图像失败: {e}"))?;
    let results = ocr
        .predict(vec![img])
        .map_err(|e| format!("OCR 预测失败: {e}"))?;

    let mut out = Vec::new();
    if let Some(res) = results.into_iter().next() {
        for region in res.text_regions {
            let points: Vec<[f32; 2]> = region
                .bounding_box
                .points
                .iter()
                .map(|p| [p.x, p.y])
                .collect();
            if points.is_empty() {
                continue;
            }
            out.push(PreannBox {
                points,
                text: region.text.map(|t| t.to_string()),
                label: None,
                score: region.confidence,
            });
        }
    }
    Ok(out)
}

pub fn run_layout(
    app: &AppHandle,
    image_path: &str,
    filter: Option<&[&str]>,
    layout_key: &str,
    device: &str,
) -> Result<Vec<PreannBox>, String> {
    let predictor = get_or_build_layout(app, layout_key, device)?;
    let img = load_image(Path::new(image_path)).map_err(|e| format!("加载图像失败: {e}"))?;
    let output = predictor
        .predict(vec![img])
        .map_err(|e| format!("版面检测失败: {e}"))?;

    let mut out = Vec::new();
    if let Some(elements) = output.elements.into_iter().next() {
        for el in elements {
            if let Some(keys) = filter {
                let et = el.element_type.to_lowercase();
                if !keys.iter().any(|k| et.contains(k)) {
                    continue;
                }
            }
            let points: Vec<[f32; 2]> = el.bbox.points.iter().map(|p| [p.x, p.y]).collect();
            if points.is_empty() {
                continue;
            }
            out.push(PreannBox {
                points,
                text: None,
                label: Some(el.element_type.clone()),
                score: Some(el.score),
            });
        }
    }
    Ok(out)
}

pub fn run_formula(
    app: &AppHandle,
    image_path: &str,
    layout_key: &str,
    formula_key: &str,
    device: &str,
) -> Result<Vec<PreannBox>, String> {
    let regions = run_layout(app, image_path, Some(&["formula"]), layout_key, device)?;
    let predictor = get_or_build_formula(app, formula_key, device)?;
    let image = load_image(Path::new(image_path)).map_err(|e| format!("加载图像失败: {e}"))?;
    let mut out = Vec::with_capacity(regions.len());

    for region in regions {
        let crop = crop_region(&image, &region.points)?;
        let result = predictor
            .predict(vec![crop])
            .map_err(|e| format!("公式识别失败: {e}"))?;
        let latex = result
            .formulas
            .into_iter()
            .next()
            .ok_or_else(|| "公式识别没有返回结果".to_string())?;
        let score = result
            .scores
            .into_iter()
            .next()
            .ok_or_else(|| "公式识别没有返回置信度结果".to_string())?;
        out.push(PreannBox {
            points: region.points,
            text: Some(latex),
            label: Some("formula".into()),
            score,
        });
    }

    Ok(out)
}

pub fn run_table(
    app: &AppHandle,
    image_path: &str,
    layout_key: &str,
    table_key: &str,
    device: &str,
) -> Result<Vec<PreannBox>, String> {
    let regions = run_layout(app, image_path, Some(&["table"]), layout_key, device)?;
    let predictor = get_or_build_table(app, table_key, device)?;
    let image = load_image(Path::new(image_path)).map_err(|e| format!("加载图像失败: {e}"))?;
    let mut out = Vec::with_capacity(regions.len());

    for region in regions {
        let crop = crop_region(&image, &region.points)?;
        let result = predictor
            .predict(vec![crop])
            .map_err(|e| format!("表格识别失败: {e}"))?;
        let structure = result
            .structures
            .into_iter()
            .next()
            .ok_or_else(|| "表格识别没有返回结构结果".to_string())?;
        out.push(PreannBox {
            points: region.points,
            text: Some(structure.join("")),
            label: Some("table".into()),
            score: None,
        });
    }

    Ok(out)
}
