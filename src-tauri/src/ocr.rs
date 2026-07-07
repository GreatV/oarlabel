//! OCR / layout inference. Pipelines are expensive to build, so each selected
//! model/device pair is built once and cached.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(feature = "cuda")]
use oar_ocr::core::config::OrtExecutionProvider;
use oar_ocr::core::config::OrtSessionConfig;
use oar_ocr::domain::structure::LayoutElementType;
use oar_ocr::domain::tasks::layout_detection::LayoutDetectionConfig;
use oar_ocr::domain::tasks::{TextDetectionConfig, TextRecognitionConfig};
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};
use oar_ocr::predictors::{
    FormulaRecognitionPredictor, LayoutDetectionPredictor, TableStructureRecognitionPredictor,
    TextRecognitionPredictor,
};
use oar_ocr::processors::layout_sorting::{sort_layout_enhanced, SortableElement};
use oar_ocr::processors::Point;
use oar_ocr::utils::{get_rotate_crop_image, load_image};
use serde::Serialize;
use tauri::AppHandle;

use crate::models;

fn resolve_model_path(app: &AppHandle, key: &str, role: &str) -> Result<PathBuf, String> {
    let def = models::def(app, key)?;
    models::resolve(app, key).ok_or_else(|| match def.source {
        models::ModelSource::Local => format!("Invalid local path for {role} ({key})"),
        _ => format!("Invalid model configuration for {role} ({key})"),
    })
}

fn resolve_predictor_asset_path(app: &AppHandle, key: &str, role: &str) -> Result<PathBuf, String> {
    let path = resolve_model_path(app, key, role)?;
    oar_ocr::download::resolve_path(&path)
        .map_err(|e| format!("Failed to resolve {role} ({key}): {e}"))
}

fn apply_text_tuning(cfg: &mut TextDetectionConfig, tuning: Option<models::TextDetectionTuning>) {
    if let Some(t) = tuning {
        if let Some(v) = t.score_threshold {
            cfg.score_threshold = v;
        }
        if let Some(v) = t.box_threshold {
            cfg.box_threshold = v;
        }
        if let Some(v) = t.unclip_ratio {
            cfg.unclip_ratio = v;
        }
    }
}

fn apply_text_recognition_tuning(
    cfg: &mut TextRecognitionConfig,
    tuning: Option<models::TextRecognitionTuning>,
) {
    if let Some(t) = tuning {
        if let Some(v) = t.score_threshold {
            cfg.score_threshold = v;
        }
    }
}

fn apply_layout_tuning(
    cfg: &mut LayoutDetectionConfig,
    tuning: Option<models::LayoutDetectionTuning>,
) {
    if let Some(t) = tuning {
        if let Some(v) = t.score_threshold {
            cfg.score_threshold = v;
        }
        if let Some(v) = t.nms_threshold {
            cfg.nms_threshold = v;
        }
        if let Some(v) = t.max_elements {
            cfg.max_elements = v;
        }
    }
}

#[derive(Serialize)]
pub struct PreannBox {
    pub points: Vec<[f32; 2]>,
    pub text: Option<String>,
    pub label: Option<String>,
    pub score: Option<f32>,
    /// Reading-order position (0-based). Only set by reading-order mode; None
    /// for OCR / layout / formula / table runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// Stable region id. Only set by the structured pipeline (`run_structure`)
    /// on layout-detected region boxes, so children can reference them via
    /// `parent_id`. None for the single-mode runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Parent region id. Only set by children produced inside `run_structure`
    /// (text/formula/table lines recognized within a region). None otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

/// Result of a pre-annotation pass: the successful boxes plus a count of
/// regions that failed (crop/recognize) and were skipped rather than aborting
/// the whole image. `skipped` is 0 for OCR / plain layout runs.
#[derive(Serialize)]
pub struct PreannResult {
    pub boxes: Vec<PreannBox>,
    pub skipped: u32,
}

impl PreannResult {
    fn no_skip(boxes: Vec<PreannBox>) -> Self {
        Self { boxes, skipped: 0 }
    }
}

#[derive(Clone, serde::Deserialize)]
pub struct TextRegionInput {
    pub id: String,
    pub points: Vec<[f32; 2]>,
}

#[derive(Serialize)]
pub struct RecognizedTextRegion {
    pub id: String,
    pub text: String,
    pub score: Option<f32>,
}

#[derive(Serialize)]
pub struct TextRecognitionRegionResult {
    pub regions: Vec<RecognizedTextRegion>,
    pub skipped: u32,
}

static OCR: OnceLock<Mutex<HashMap<String, Arc<OAROCR>>>> = OnceLock::new();
static TEXT_RECOGNITION: OnceLock<Mutex<HashMap<String, Arc<TextRecognitionPredictor>>>> =
    OnceLock::new();
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
                    .map_err(|_| format!("Invalid CUDA device index: {device}"))?
            } else {
                return Err(format!(
                    "Invalid device format: {device}; expected 'cuda' or 'cuda:N'"
                ));
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
                "CUDA was selected, but this build does not enable CUDA support. Use CPU or rebuild with `cargo build --features cuda`."
                    .into(),
            );
        }
    }

    Err(format!(
        "Unsupported device: {device}; supported values are cpu / auto"
    ))
}

fn get_or_build_ocr(
    app: &AppHandle,
    profile_key: &str,
    device: &str,
    tuning: Option<models::InferenceTuning>,
) -> Result<Arc<OAROCR>, String> {
    let prof = models::profile(app, profile_key)?;
    let mut text_config = TextDetectionConfig::default();
    let mut rec_config = TextRecognitionConfig::default();
    apply_text_tuning(&mut text_config, prof.text_detection);
    apply_text_tuning(&mut text_config, tuning.and_then(|t| t.ocr));
    apply_text_recognition_tuning(&mut rec_config, prof.text_recognition);
    apply_text_recognition_tuning(&mut rec_config, tuning.and_then(|t| t.text_recognition));
    let cache_key = format!(
        "{profile_key}|{device}|td:{:.4}:{:.4}:{:.4}|tr:{:.4}|tlo:{}",
        text_config.score_threshold,
        text_config.box_threshold,
        text_config.unclip_ratio,
        rec_config.score_threshold,
        models::TEXT_LINE_ORIENTATION_MODEL_KEY
    );
    let cell = OCR.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        tracing::debug!(profile = %profile_key, device = %device, "reuse cached OCR pipeline");
        return Ok(existing.clone());
    }

    let det = resolve_model_path(app, &prof.det, "text detection model")?;
    let rec = resolve_predictor_asset_path(app, &prof.rec, "text recognition model")?;
    let dict = resolve_predictor_asset_path(app, &prof.dict, "text recognition dictionary")?;
    let text_line_orientation = resolve_model_path(
        app,
        models::TEXT_LINE_ORIENTATION_MODEL_KEY,
        "text line orientation model",
    )?;

    tracing::info!(
        profile = %profile_key,
        device = %device,
        det = %det.display(),
        rec = %rec.display(),
        dict = %dict.display(),
        "building OCR pipeline"
    );
    let mut builder = OAROCRBuilder::new(&det, &rec, &dict);
    builder = builder.text_detection_config(text_config);
    builder = builder.text_recognition_config(rec_config);
    builder = builder.with_text_line_orientation_classification(text_line_orientation);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.ort_session(cfg);
    }
    let ocr = builder
        .build()
        .map_err(|e| format!("Failed to build OCR pipeline: {e}"))?;
    let arc = Arc::new(ocr);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    // Keep only the most recently built pipeline: a single formula/table model
    // can weigh 200MB–1.7GB, so otherwise switching models just accumulates
    // memory that is never released.
    guard.clear();
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

fn get_or_build_text_recognition(
    app: &AppHandle,
    profile_key: &str,
    device: &str,
    tuning: Option<models::TextRecognitionTuning>,
) -> Result<Arc<TextRecognitionPredictor>, String> {
    let prof = models::profile(app, profile_key)?;
    let mut rec_config = TextRecognitionConfig::default();
    apply_text_recognition_tuning(&mut rec_config, prof.text_recognition);
    apply_text_recognition_tuning(&mut rec_config, tuning);
    let cache_key = format!(
        "{profile_key}|{device}|tr:{:.4}",
        rec_config.score_threshold
    );
    let cell = TEXT_RECOGNITION.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        tracing::debug!(
            profile = %profile_key,
            device = %device,
            "reuse cached text recognition predictor"
        );
        return Ok(existing.clone());
    }

    let rec = resolve_predictor_asset_path(app, &prof.rec, "text recognition model")?;
    let dict = resolve_predictor_asset_path(app, &prof.dict, "text recognition dictionary")?;
    tracing::info!(
        profile = %profile_key,
        device = %device,
        rec = %rec.display(),
        dict = %dict.display(),
        score_threshold = rec_config.score_threshold,
        "building text recognition predictor"
    );
    let mut builder = TextRecognitionPredictor::builder()
        .score_threshold(rec_config.score_threshold)
        .dict_path(&dict);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&rec)
        .map_err(|e| format!("Failed to build text recognizer: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.clear();
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

fn get_or_build_layout(
    app: &AppHandle,
    layout_key: &str,
    device: &str,
    tuning: Option<models::LayoutDetectionTuning>,
) -> Result<Arc<LayoutDetectionPredictor>, String> {
    let d = models::def(app, layout_key).and_then(|d| {
        if d.kind == models::ModelKind::Layout {
            Ok(d)
        } else {
            Err(format!("Not a layout detection model: {layout_key}"))
        }
    })?;
    let mut layout_config = LayoutDetectionConfig::default();
    apply_layout_tuning(&mut layout_config, d.layout_detection);
    apply_layout_tuning(&mut layout_config, tuning);
    let cache_key = format!(
        "{layout_key}|{device}|ld:{:.4}:{:.4}:{}",
        layout_config.score_threshold, layout_config.nms_threshold, layout_config.max_elements
    );
    let cell = LAYOUT.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing.clone());
    }

    let model = resolve_model_path(app, layout_key, "layout detection model")?;
    let model_name = d
        .pipeline_name
        .ok_or_else(|| format!("Layout detection model is missing pipeline_name: {layout_key}"))?;

    let mut builder = LayoutDetectionPredictor::builder()
        .with_config(layout_config)
        .model_name(model_name);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&model)
        .map_err(|e| format!("Failed to build layout detector: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.clear();
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
    let model = resolve_model_path(app, &prof.model, "formula recognition model")?;
    let tokenizer = resolve_model_path(app, &prof.tokenizer, "formula recognition tokenizer")?;

    let mut builder = FormulaRecognitionPredictor::builder()
        .model_name(&prof.model_name)
        .tokenizer_path(&tokenizer);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&model)
        .map_err(|e| format!("Failed to build formula recognizer: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.clear();
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
    let model = resolve_model_path(app, &prof.structure, "table recognition model")?;
    let dict = resolve_model_path(app, &prof.dict, "table structure dictionary")?;

    let mut builder = TableStructureRecognitionPredictor::builder()
        .model_name(&prof.model_name)
        .dict_path(&dict);
    if let Some(cfg) = ort_config_for(device)? {
        builder = builder.with_ort_config(cfg);
    }
    let predictor = builder
        .build(&model)
        .map_err(|e| format!("Failed to build table recognizer: {e}"))?;
    let arc = Arc::new(predictor);
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&cache_key) {
        return Ok(existing.clone());
    }
    guard.clear();
    guard.insert(cache_key, arc.clone());
    Ok(arc)
}

/// Crop an axis-aligned region from the image. Returns the crop plus its
/// top-left origin `(x0, y0)` in image coordinates, so callers that run a
/// recognizer on the crop (OCR) can map detected boxes back into image space.
fn crop_region(
    image: &image::RgbImage,
    points: &[[f32; 2]],
) -> Result<(image::RgbImage, (u32, u32)), String> {
    // Callers (run_formula / run_table / run_structure) only pass regions from
    // run_layout, which already drops empty-point boxes, so points is non-empty
    // here; the degenerate-case check below also catches an empty slice.
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
        return Err("Invalid recognition region coordinates".into());
    }

    let image_width = image.width() as f32;
    let image_height = image.height() as f32;
    let x0 = x_min.floor().clamp(0.0, image_width) as u32;
    let y0 = y_min.floor().clamp(0.0, image_height) as u32;
    let x1 = x_max.ceil().clamp(0.0, image_width) as u32;
    let y1 = y_max.ceil().clamp(0.0, image_height) as u32;
    if x1 <= x0 || y1 <= y0 {
        return Err("Recognition region is outside the image bounds".into());
    }

    let crop = image::imageops::crop_imm(image, x0, y0, x1 - x0, y1 - y0).to_image();
    Ok((crop, (x0, y0)))
}

fn point_dist(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn order_quad(points: &[[f32; 2]]) -> [[f32; 2]; 4] {
    if points.len() == 4 {
        let mut tl = points[0];
        let mut br = points[0];
        let mut tr = points[0];
        let mut bl = points[0];
        let (mut min_sum, mut max_sum) = (f32::INFINITY, f32::NEG_INFINITY);
        let (mut min_diff, mut max_diff) = (f32::INFINITY, f32::NEG_INFINITY);
        for &p in points {
            let sum = p[0] + p[1];
            let diff = p[1] - p[0];
            if sum < min_sum {
                min_sum = sum;
                tl = p;
            }
            if sum > max_sum {
                max_sum = sum;
                br = p;
            }
            if diff < min_diff {
                min_diff = diff;
                tr = p;
            }
            if diff > max_diff {
                max_diff = diff;
                bl = p;
            }
        }
        [tl, tr, br, bl]
    } else {
        let xs = points.iter().map(|p| p[0]);
        let ys = points.iter().map(|p| p[1]);
        let x0 = xs.clone().fold(f32::INFINITY, f32::min);
        let x1 = xs.fold(f32::NEG_INFINITY, f32::max);
        let y0 = ys.clone().fold(f32::INFINITY, f32::min);
        let y1 = ys.fold(f32::NEG_INFINITY, f32::max);
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }
}

fn is_vertical_quad(points: &[[f32; 2]]) -> bool {
    if points.is_empty() {
        return false;
    }
    let [tl, tr, br, bl] = order_quad(points);
    if ![tl, tr, br, bl]
        .iter()
        .all(|p| p[0].is_finite() && p[1].is_finite())
    {
        return false;
    }

    let w = point_dist(tl, tr).max(point_dist(bl, br));
    let h = point_dist(tl, bl).max(point_dist(tr, br));
    h >= w * 1.2
}

fn crop_quad(src: &image::RgbImage, points: &[[f32; 2]]) -> Result<image::RgbImage, String> {
    if points.is_empty() {
        return Err("Invalid recognition region coordinates".into());
    }
    let [tl, tr, br, bl] = order_quad(points);
    if ![tl, tr, br, bl]
        .iter()
        .all(|p| p[0].is_finite() && p[1].is_finite())
    {
        return Err("Invalid recognition region coordinates".into());
    }

    let box_points = [tl, tr, br, bl]
        .into_iter()
        .map(|p| Point::new(p[0], p[1]))
        .collect::<Vec<_>>();
    get_rotate_crop_image(src, &box_points)
        .map_err(|e| format!("Failed to crop recognition region: {e}"))
}

pub fn recognize_text_regions(
    app: &AppHandle,
    image_path: &str,
    profile_key: &str,
    device: &str,
    regions: Vec<TextRegionInput>,
    tuning: Option<models::InferenceTuning>,
) -> Result<TextRecognitionRegionResult, String> {
    let requested = regions.len();
    tracing::info!(
        image = %image_path,
        profile = %profile_key,
        device = %device,
        regions = requested,
        "recognize text regions"
    );
    let predictor = get_or_build_text_recognition(
        app,
        profile_key,
        device,
        tuning.and_then(|t| t.text_recognition),
    )?;
    let image =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let mut ids = Vec::new();
    let mut crops = Vec::new();
    let mut crop_region_indexes = Vec::new();
    let mut skipped = 0;

    for region in regions {
        let should_try_vertical = is_vertical_quad(&region.points);
        match crop_quad(&image, &region.points) {
            Ok(crop) => {
                let region_idx = ids.len();
                ids.push(region.id);
                if should_try_vertical {
                    crops.push(crop.clone());
                    crop_region_indexes.push(region_idx);
                    crops.push(image::imageops::rotate90(&crop));
                    crop_region_indexes.push(region_idx);
                } else {
                    crops.push(crop);
                    crop_region_indexes.push(region_idx);
                }
            }
            Err(e) => {
                skipped += 1;
                tracing::warn!(region_id = %region.id, error = %e, "skip invalid text region");
            }
        }
    }

    if crops.is_empty() {
        tracing::warn!(regions = requested, skipped, "no valid text region crops");
        return Ok(TextRecognitionRegionResult {
            regions: Vec::new(),
            skipped,
        });
    }

    let result = predictor
        .predict(crops)
        .map_err(|e| format!("Text recognition failed: {e}"))?;
    let mut best = vec![None::<(String, f32)>; ids.len()];
    for (candidate_idx, region_idx) in crop_region_indexes.into_iter().enumerate() {
        let Some(text) = result.texts.get(candidate_idx).cloned() else {
            continue;
        };
        let score = result.scores.get(candidate_idx).copied().unwrap_or(0.0);
        let replace = best
            .get(region_idx)
            .and_then(|value| value.as_ref())
            .map(|(_, existing_score)| score > *existing_score)
            .unwrap_or(true);
        if replace {
            best[region_idx] = Some((text, score));
        }
    }

    let mut out = Vec::new();
    for (idx, id) in ids.into_iter().enumerate() {
        let Some((text, score)) = best.get(idx).cloned().flatten() else {
            skipped += 1;
            continue;
        };
        out.push(RecognizedTextRegion {
            id,
            text,
            score: Some(score),
        });
    }

    tracing::info!(
        requested,
        recognized = out.len(),
        skipped,
        "text region recognition completed"
    );
    Ok(TextRecognitionRegionResult {
        regions: out,
        skipped,
    })
}

pub fn recognize_formula_regions(
    app: &AppHandle,
    image_path: &str,
    formula_key: &str,
    device: &str,
    regions: Vec<TextRegionInput>,
) -> Result<TextRecognitionRegionResult, String> {
    let requested = regions.len();
    tracing::info!(
        image = %image_path,
        formula = %formula_key,
        device = %device,
        regions = requested,
        "recognize formula regions"
    );
    let predictor = get_or_build_formula(app, formula_key, device)?;
    let image =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let mut ids = Vec::new();
    let mut crops = Vec::new();
    let mut skipped = 0;

    for region in regions {
        match crop_quad(&image, &region.points) {
            Ok(crop) => {
                ids.push(region.id);
                crops.push(crop);
            }
            Err(e) => {
                skipped += 1;
                tracing::warn!(region_id = %region.id, error = %e, "skip invalid formula region");
            }
        }
    }

    if crops.is_empty() {
        tracing::warn!(
            regions = requested,
            skipped,
            "no valid formula region crops"
        );
        return Ok(TextRecognitionRegionResult {
            regions: Vec::new(),
            skipped,
        });
    }

    let result = predictor
        .predict(crops)
        .map_err(|e| format!("Formula recognition failed: {e}"))?;
    let mut out = Vec::new();
    for (idx, id) in ids.into_iter().enumerate() {
        let Some(text) = result.formulas.get(idx).cloned() else {
            skipped += 1;
            continue;
        };
        let score = result.scores.get(idx).copied().flatten();
        out.push(RecognizedTextRegion { id, text, score });
    }

    tracing::info!(
        requested,
        recognized = out.len(),
        skipped,
        "formula region recognition completed"
    );
    Ok(TextRecognitionRegionResult {
        regions: out,
        skipped,
    })
}

pub fn run_ocr(
    app: &AppHandle,
    image_path: &str,
    profile_key: &str,
    device: &str,
    tuning: Option<models::InferenceTuning>,
) -> Result<PreannResult, String> {
    let ocr = get_or_build_ocr(app, profile_key, device, tuning)?;
    let img =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let results = ocr
        .predict(vec![img])
        .map_err(|e| format!("OCR prediction failed: {e}"))?;

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
                order: None,
                id: None,
                parent_id: None,
            });
        }
    }
    Ok(PreannResult::no_skip(out))
}

/// Reading-order mode. oar-ocr's `predict` already returns text regions sorted
/// into reading order (line-aware top-to-bottom, left-to-right via
/// `sort_quad_boxes`), so this is OCR plus a 0-based position index attached to
/// each box so the frontend/export can expose a stable sequence.
pub fn run_reading_order(
    app: &AppHandle,
    image_path: &str,
    profile_key: &str,
    device: &str,
    tuning: Option<models::InferenceTuning>,
) -> Result<PreannResult, String> {
    let ocr = get_or_build_ocr(app, profile_key, device, tuning)?;
    let img =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let results = ocr
        .predict(vec![img])
        .map_err(|e| format!("OCR prediction failed: {e}"))?;

    let mut out = Vec::new();
    if let Some(res) = results.into_iter().next() {
        // text_regions arrive in reading order; enumerate to assign the index.
        for (i, region) in res.text_regions.into_iter().enumerate() {
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
                order: Some(i as u32),
                id: None,
                parent_id: None,
            });
        }
    }
    Ok(PreannResult::no_skip(out))
}

pub fn run_layout(
    app: &AppHandle,
    image_path: &str,
    filter: Option<&[&str]>,
    layout_key: &str,
    device: &str,
    tuning: Option<models::InferenceTuning>,
) -> Result<PreannResult, String> {
    let predictor = get_or_build_layout(app, layout_key, device, tuning.and_then(|t| t.layout))?;
    let img =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let (page_width, page_height) = (img.width() as f32, img.height() as f32);
    let output = predictor
        .predict(vec![img])
        .map_err(|e| format!("Layout detection failed: {e}"))?;

    let mut out = Vec::new();
    if let Some(mut elements) = output.elements.into_iter().next() {
        if !output.is_reading_order_sorted {
            let sortable = elements
                .iter()
                .map(|el| SortableElement {
                    bbox: el.bbox.clone(),
                    element_type: LayoutElementType::from_label(&el.element_type),
                    num_lines: None,
                })
                .collect::<Vec<_>>();
            let order = sort_layout_enhanced(&sortable, page_width, page_height);
            if order.len() == elements.len() {
                let original = elements;
                elements = order
                    .into_iter()
                    .filter_map(|idx| original.get(idx).cloned())
                    .collect();
            }
        }

        for el in elements {
            if let Some(keys) = filter {
                // Exact label match (case-insensitive). `contains` would let a
                // short key like "table" also match "table_title" /
                // "figure_table_chart_title", and "formula" match
                // "formula_number", so the table/formula modes would crop
                // captions and equation numbers and feed them to the structure
                // / formula recognizer. oar-ocr labels are snake_case
                // ("table", "formula", "table_title", "formula_number", ...).
                let et = el.element_type.to_lowercase();
                if !keys.iter().any(|k| et == *k) {
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
                order: Some(out.len() as u32),
                id: None,
                parent_id: None,
            });
        }
    }
    Ok(PreannResult::no_skip(out))
}

pub fn run_formula(
    app: &AppHandle,
    image_path: &str,
    layout_key: &str,
    formula_key: &str,
    device: &str,
    tuning: Option<models::InferenceTuning>,
) -> Result<PreannResult, String> {
    // run_layout returns PreannResult; for formula mode it never skips, so the
    // layout boxes are the candidate regions.
    let regions = run_layout(
        app,
        image_path,
        Some(&["formula"]),
        layout_key,
        device,
        tuning,
    )?
    .boxes;
    let predictor = get_or_build_formula(app, formula_key, device)?;
    let image =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let mut out = Vec::with_capacity(regions.len());
    // Skip regions that fail to crop or recognize instead of aborting the whole
    // page: a single bad crop used to discard every formula on the image.
    let mut skipped: u32 = 0;

    for (i, region) in regions.into_iter().enumerate() {
        let crop = match crop_region(&image, &region.points) {
            Ok((c, _origin)) => c,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let result = match predictor.predict(vec![crop]) {
            Ok(r) => r,
            Err(e) => {
                // A predictor (model) failure is systemic — wrong model, build
                // failure, device mismatch. The FIRST region surfacing it means
                // every region would fail, so return the error instead of
                // masking it as "0 results, N skipped". Later-region failures
                // are still treated as skippable (one bad crop shouldn't kill
                // the whole page).
                if i == 0 {
                    return Err(format!("Formula recognition failed: {e}"));
                }
                skipped += 1;
                continue;
            }
        };
        let latex = match result.formulas.into_iter().next() {
            Some(l) => l,
            None => {
                skipped += 1;
                continue;
            }
        };
        let score = match result.scores.into_iter().next() {
            Some(s) => s,
            None => {
                skipped += 1;
                continue;
            }
        };
        out.push(PreannBox {
            points: region.points,
            text: Some(latex),
            label: Some("formula".into()),
            score,
            order: None,
            id: None,
            parent_id: None,
        });
    }

    Ok(PreannResult {
        boxes: out,
        skipped,
    })
}

pub fn run_table(
    app: &AppHandle,
    image_path: &str,
    layout_key: &str,
    table_key: &str,
    device: &str,
    tuning: Option<models::InferenceTuning>,
) -> Result<PreannResult, String> {
    let regions = run_layout(
        app,
        image_path,
        Some(&["table"]),
        layout_key,
        device,
        tuning,
    )?
    .boxes;
    let predictor = get_or_build_table(app, table_key, device)?;
    let image =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let mut out = Vec::with_capacity(regions.len());
    // As with formulas, skip a bad region rather than failing every table.
    let mut skipped: u32 = 0;

    for (i, region) in regions.into_iter().enumerate() {
        let crop = match crop_region(&image, &region.points) {
            Ok((c, _origin)) => c,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let result = match predictor.predict(vec![crop]) {
            Ok(r) => r,
            Err(e) => {
                // See run_formula: a model/predictor failure is systemic, so
                // surface it on the first region rather than masking as
                // "0 results, N skipped". Later regions stay skippable.
                if i == 0 {
                    return Err(format!("Table recognition failed: {e}"));
                }
                skipped += 1;
                continue;
            }
        };
        let structure = match result.structures.into_iter().next() {
            Some(s) => s,
            None => {
                skipped += 1;
                continue;
            }
        };
        out.push(PreannBox {
            points: region.points,
            text: Some(structure.join("")),
            label: Some("table".into()),
            score: None,
            order: None,
            id: None,
            parent_id: None,
        });
    }

    Ok(PreannResult {
        boxes: out,
        skipped,
    })
}

/// Layout labels that contain readable text. In the structured pipeline these
/// regions are cropped and fed to OCR to produce text-line children; other
/// labels (figure, chart, …) stay as leaf regions.
fn is_text_region(label: &str) -> bool {
    matches!(
        label.to_lowercase().as_str(),
        "text"
            | "title"
            | "plain_text"
            | "paragraph"
            | "header"
            | "footer"
            | "caption"
            | "table_caption"
            | "table_text"
            | "formula" // OCR often reads surrounding line; harmless
    )
}

/// Pre-annotation dispatch over the active `modes`. The shape of the result
/// depends on whether `layout` is among them:
///
/// - **`layout` active** → structured pipeline: layout runs once and its regions
///   become parents; each selected recognizer then enriches the matching region
///   type (text regions → OCR children, `formula` regions → LaTeX children,
///   `table` regions → table-structure children). Children link back to their
///   region via `parent_id`.
/// - **`layout` not active** → flat pipeline: each selected mode runs on the
///   whole image independently and its boxes are concatenated, with no parent/
///   child linkage. E.g. only `ocr` → pure OCR run; only `formula` → whole-image
///   formula recognition.
///
/// `reading` ⊇ `ocr` (a reading box is an OCR box plus an order index), so when
/// both are active only `reading` runs in the flat path to avoid double-counting.
pub struct StructureRunConfig<'a> {
    pub layout_key: &'a str,
    pub ocr_key: &'a str,
    pub formula_key: &'a str,
    pub table_key: &'a str,
    pub device: &'a str,
    pub tuning: Option<models::InferenceTuning>,
}

pub fn run_structure(
    app: &AppHandle,
    image_path: &str,
    modes: &[String],
    config: StructureRunConfig<'_>,
) -> Result<PreannResult, String> {
    let want_layout = modes.iter().any(|m| m == "layout");
    if !want_layout {
        return run_flat(app, image_path, modes, &config);
    }
    run_structured(app, image_path, modes, &config)
}

/// Flat pipeline (no `layout` mode): run each selected recognizer on the whole
/// image and concatenate the resulting boxes. No region/parent linkage.
///
/// Note: `run_formula` / `run_table` internally use a layout detector to locate
/// candidate regions (they always have), so they still receive `layout_key`.
/// The user-facing distinction is that no top-level layout *regions* are emitted
/// here — only the recognized formula/table boxes.
fn run_flat(
    app: &AppHandle,
    image_path: &str,
    modes: &[String],
    config: &StructureRunConfig<'_>,
) -> Result<PreannResult, String> {
    let want_reading = modes.iter().any(|m| m == "reading");
    let want_ocr = modes.iter().any(|m| m == "ocr");
    let want_formula = modes.iter().any(|m| m == "formula");
    let want_table = modes.iter().any(|m| m == "table");

    let mut out: Vec<PreannBox> = Vec::new();
    let mut skipped: u32 = 0;

    // `reading` produces OCR boxes + an order index, so it supersedes plain OCR
    // when both are active — run only reading to avoid duplicating text boxes.
    if want_reading {
        let r = run_reading_order(
            app,
            image_path,
            config.ocr_key,
            config.device,
            config.tuning,
        )?;
        skipped += r.skipped;
        out.extend(r.boxes);
    } else if want_ocr {
        let r = run_ocr(
            app,
            image_path,
            config.ocr_key,
            config.device,
            config.tuning,
        )?;
        skipped += r.skipped;
        out.extend(r.boxes);
    }
    if want_formula {
        let r = run_formula(
            app,
            image_path,
            config.layout_key,
            config.formula_key,
            config.device,
            config.tuning,
        )?;
        skipped += r.skipped;
        out.extend(r.boxes);
    }
    if want_table {
        let r = run_table(
            app,
            image_path,
            config.layout_key,
            config.table_key,
            config.device,
            config.tuning,
        )?;
        skipped += r.skipped;
        out.extend(r.boxes);
    }

    Ok(PreannResult {
        boxes: out,
        skipped,
    })
}

/// Structured pipeline (`layout` mode active): see `run_structure` docs.
fn run_structured(
    app: &AppHandle,
    image_path: &str,
    modes: &[String],
    config: &StructureRunConfig<'_>,
) -> Result<PreannResult, String> {
    let want_ocr = modes.iter().any(|m| m == "ocr" || m == "reading");
    let want_reading = modes.iter().any(|m| m == "reading");
    let want_formula = modes.iter().any(|m| m == "formula");
    let want_table = modes.iter().any(|m| m == "table");

    // Layout is always the skeleton: regions become parents.
    let regions = run_layout(
        app,
        image_path,
        None,
        config.layout_key,
        config.device,
        config.tuning,
    )?
    .boxes;
    let image =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;

    let ocr = if want_ocr {
        Some(get_or_build_ocr(
            app,
            config.ocr_key,
            config.device,
            config.tuning,
        )?)
    } else {
        None
    };
    let formula_predictor = if want_formula {
        Some(get_or_build_formula(
            app,
            config.formula_key,
            config.device,
        )?)
    } else {
        None
    };
    let table_predictor = if want_table {
        Some(get_or_build_table(app, config.table_key, config.device)?)
    } else {
        None
    };

    let mut out: Vec<PreannBox> = Vec::new();
    let mut skipped: u32 = 0;

    for (r_idx, region) in regions.into_iter().enumerate() {
        let region_id = format!("r{r_idx}");
        let label = region.label.clone().unwrap_or_default();
        let label_lower = label.to_lowercase();

        // Emit the region itself as a parent (always, so the structure is
        // visible even when no recognizer enriched it).
        out.push(PreannBox {
            points: region.points.clone(),
            text: None,
            label: region.label.clone(),
            score: region.score,
            order: None,
            id: Some(region_id.clone()),
            parent_id: None,
        });

        let crop_result = crop_region(&image, &region.points);
        let (crop, origin) = match crop_result {
            Ok(v) => v,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        // OCR text-line children for text-like regions.
        if want_ocr && is_text_region(&label_lower) {
            if let Some(predictor) = &ocr {
                match predictor.predict(vec![crop.clone()]) {
                    Ok(results) => {
                        if let Some(res) = results.into_iter().next() {
                            for (line_idx, tr) in res.text_regions.into_iter().enumerate() {
                                // OCR boxes are relative to the crop; offset them
                                // back into image coordinates by the crop origin.
                                let points: Vec<[f32; 2]> = tr
                                    .bounding_box
                                    .points
                                    .iter()
                                    .map(|p| [p.x + origin.0 as f32, p.y + origin.1 as f32])
                                    .collect();
                                if points.is_empty() {
                                    continue;
                                }
                                out.push(PreannBox {
                                    points,
                                    text: tr.text.map(|t| t.to_string()),
                                    label: Some("text".into()),
                                    score: tr.confidence,
                                    order: want_reading.then_some((r_idx * 1000 + line_idx) as u32),
                                    id: None,
                                    parent_id: Some(region_id.clone()),
                                });
                            }
                        }
                    }
                    Err(e) => {
                        // OCR predictor failure is systemic (wrong model /
                        // device). Surface it rather than masking as skipped.
                        return Err(format!("OCR recognition failed: {e}"));
                    }
                }
            }
        }

        // Formula LaTeX child for formula regions.
        if want_formula && label_lower == "formula" {
            if let Some(predictor) = &formula_predictor {
                match predictor.predict(vec![crop.clone()]) {
                    Ok(result) => {
                        // `scores` is Vec<Option<f32>>; mirror run_formula's
                        // extraction so a missing score skips the region.
                        let latex = result.formulas.into_iter().next();
                        let score = result.scores.into_iter().next().flatten();
                        if let (Some(latex), score) = (latex, score) {
                            out.push(PreannBox {
                                // The LaTeX describes the whole region.
                                points: region.points.clone(),
                                text: Some(latex),
                                label: Some("formula".into()),
                                score,
                                order: None,
                                id: None,
                                parent_id: Some(region_id.clone()),
                            });
                        } else {
                            skipped += 1;
                        }
                    }
                    Err(e) => {
                        return Err(format!("Formula recognition failed: {e}"));
                    }
                }
            }
        }

        // Table structure child for table regions.
        if want_table && label_lower == "table" {
            if let Some(predictor) = &table_predictor {
                match predictor.predict(vec![crop]) {
                    Ok(result) => {
                        if let Some(structure) = result.structures.into_iter().next() {
                            out.push(PreannBox {
                                points: region.points.clone(),
                                text: Some(structure.join("")),
                                label: Some("table".into()),
                                score: None,
                                order: None,
                                id: None,
                                parent_id: Some(region_id.clone()),
                            });
                        } else {
                            skipped += 1;
                        }
                    }
                    Err(e) => {
                        return Err(format!("Table recognition failed: {e}"));
                    }
                }
            }
        }
    }

    Ok(PreannResult {
        boxes: out,
        skipped,
    })
}
