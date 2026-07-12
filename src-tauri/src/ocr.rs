//! OCR / layout inference. Pipelines are expensive to build, so each selected
//! model/device pair is built once and cached.

use std::cell::Cell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(all(feature = "cuda", not(target_os = "macos")))]
use oar_ocr::core::config::OrtExecutionProvider;
use oar_ocr::core::config::OrtSessionConfig;
use oar_ocr::domain::structure::LayoutElementType;
use oar_ocr::domain::tasks::layout_detection::LayoutDetectionConfig;
use oar_ocr::domain::tasks::{TextDetectionConfig, TextRecognitionConfig};
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};
use oar_ocr::predictors::{
    FormulaRecognitionPredictor, LayoutDetectionPredictor, TextRecognitionPredictor,
};
use oar_ocr::processors::layout_sorting::{sort_layout_enhanced, SortableElement};
use oar_ocr::utils::load_image;
use serde::Serialize;
use tauri::AppHandle;
use unicode_bidi::BidiInfo;

use crate::{geometry, models};

static PREANNOTATION_CANCEL_GENERATION: AtomicU64 = AtomicU64::new(0);
const PREANNOTATION_CANCELLED_ERROR: &str = "Pre-annotation cancelled";

thread_local! {
    static PREANNOTATION_RUN_GENERATION: Cell<Option<u64>> = const { Cell::new(None) };
}

pub fn begin_preannotation_run() {
    let generation = PREANNOTATION_CANCEL_GENERATION.load(Ordering::Acquire);
    PREANNOTATION_RUN_GENERATION.set(Some(generation));
}

pub fn finish_preannotation_run() {
    PREANNOTATION_RUN_GENERATION.set(None);
}

pub fn request_preannotation_cancel() {
    PREANNOTATION_CANCEL_GENERATION.fetch_add(1, Ordering::AcqRel);
}

fn check_preannotation_cancelled() -> Result<(), String> {
    let current = PREANNOTATION_CANCEL_GENERATION.load(Ordering::Acquire);
    let cancelled = PREANNOTATION_RUN_GENERATION
        .get()
        .is_some_and(|generation| generation != current);
    if cancelled {
        Err(PREANNOTATION_CANCELLED_ERROR.into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::{
        begin_preannotation_run, check_preannotation_cancelled, finish_preannotation_run,
        request_preannotation_cancel,
    };

    #[test]
    fn cancellation_only_affects_runs_started_before_the_request() {
        begin_preannotation_run();
        assert!(check_preannotation_cancelled().is_ok());

        request_preannotation_cancel();
        assert!(check_preannotation_cancelled().is_err());

        begin_preannotation_run();
        assert!(check_preannotation_cancelled().is_ok());
        finish_preannotation_run();
    }
}

#[cfg(test)]
mod rtl_text_tests {
    use super::reorder_bidi_text;

    #[test]
    fn converts_visual_rtl_text_to_logical_order() {
        assert_eq!(
            reorder_bidi_text("\u{0627}\u{0628}\u{062d}\u{0631}\u{0645}"),
            "\u{0645}\u{0631}\u{062d}\u{0628}\u{0627}"
        );
    }

    #[test]
    fn leaves_ltr_text_unchanged() {
        assert_eq!(reorder_bidi_text("hello 123"), "hello 123");
    }
}

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

fn should_postprocess_rtl(profile: &models::OcrProfile) -> bool {
    matches!(
        profile.text_direction,
        Some(models::TextDirection::Rtl | models::TextDirection::Auto)
    )
}

fn reorder_bidi_line(line: &str) -> String {
    let bidi_info = BidiInfo::new(line, None);
    let Some(para) = bidi_info.paragraphs.first() else {
        return line.to_string();
    };

    bidi_info
        .reorder_line(para, para.range.clone())
        .into_owned()
}

fn reorder_bidi_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());

    for segment in text.split_inclusive('\n') {
        if let Some(line) = segment.strip_suffix('\n') {
            out.push_str(&reorder_bidi_line(line));
            out.push('\n');
        } else {
            out.push_str(&reorder_bidi_line(segment));
        }
    }

    out
}

fn postprocess_text_for_profile(profile: &models::OcrProfile, text: String) -> String {
    if should_postprocess_rtl(profile) {
        reorder_bidi_text(&text)
    } else {
        text
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
// Model construction is memory-intensive. Cache lookup remains concurrent,
// but a cold miss is singleflight so parallel batch requests cannot build the
// same (or multiple large) pipelines at the same time.
static PIPELINE_BUILD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock_pipeline_build() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    PIPELINE_BUILD_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|e| e.to_string())
}

fn ort_config_for(device: &str) -> Result<Option<OrtSessionConfig>, String> {
    let d = device.to_lowercase();
    if d.is_empty() || d == "cpu" || d == "auto" {
        return Ok(None);
    }

    #[cfg(all(feature = "cuda", not(target_os = "macos")))]
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

    #[cfg(not(all(feature = "cuda", not(target_os = "macos"))))]
    {
        if d.starts_with("cuda") {
            return Err(
                "CUDA was selected, but this platform/build does not enable CUDA support. Use CPU."
                    .into(),
            );
        }
    }

    let supported = if cfg!(all(feature = "cuda", not(target_os = "macos"))) {
        "cpu / cuda"
    } else {
        "cpu"
    };
    Err(format!(
        "Unsupported device: {device}; supported values are {supported}"
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
    let _build_guard = lock_pipeline_build()?;
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing);
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
    // Keep only the most recently built pipeline so switching models does not
    // accumulate large inference sessions that are never released.
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
    let _build_guard = lock_pipeline_build()?;
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing);
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
    let _build_guard = lock_pipeline_build()?;
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing);
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
    let _build_guard = lock_pipeline_build()?;
    if let Some(existing) = cell
        .lock()
        .map_err(|e| e.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(existing);
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

pub fn recognize_text_regions(
    app: &AppHandle,
    image_path: &str,
    profile_key: &str,
    device: &str,
    regions: Vec<TextRegionInput>,
    tuning: Option<models::InferenceTuning>,
) -> Result<TextRecognitionRegionResult, String> {
    let requested = regions.len();
    let prof = models::profile(app, profile_key)?;
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
        let should_try_vertical = geometry::is_vertical_quad(&region.points);
        match geometry::crop_quad(&image, &region.points) {
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
        let text = postprocess_text_for_profile(&prof, text);
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
        match geometry::crop_quad(&image, &region.points) {
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
    check_preannotation_cancelled()?;
    let prof = models::profile(app, profile_key)?;
    let ocr = get_or_build_ocr(app, profile_key, device, tuning)?;
    check_preannotation_cancelled()?;
    let img =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    check_preannotation_cancelled()?;
    let results = ocr
        .predict(vec![img])
        .map_err(|e| format!("OCR prediction failed: {e}"))?;
    check_preannotation_cancelled()?;

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
            let text = region
                .text
                .map(|t| postprocess_text_for_profile(&prof, t.to_string()));
            out.push(PreannBox {
                points,
                text,
                label: None,
                score: region.confidence,
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
    check_preannotation_cancelled()?;
    let predictor = get_or_build_layout(app, layout_key, device, tuning.and_then(|t| t.layout))?;
    check_preannotation_cancelled()?;
    let img =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let (page_width, page_height) = (img.width() as f32, img.height() as f32);
    check_preannotation_cancelled()?;
    let output = predictor
        .predict(vec![img])
        .map_err(|e| format!("Layout detection failed: {e}"))?;
    check_preannotation_cancelled()?;

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
            check_preannotation_cancelled()?;
            if let Some(keys) = filter {
                // Exact label match (case-insensitive). `contains` would let a
                // short key like "formula" also match "formula_number", so
                // formula mode would crop equation numbers and feed them to the
                // recognizer. oar-ocr labels are snake_case.
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
    check_preannotation_cancelled()?;
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
    check_preannotation_cancelled()?;
    let predictor = get_or_build_formula(app, formula_key, device)?;
    check_preannotation_cancelled()?;
    let image =
        load_image(Path::new(image_path)).map_err(|e| format!("Failed to load image: {e}"))?;
    let mut out = Vec::with_capacity(regions.len());
    // Skip regions that fail to crop or recognize instead of aborting the whole
    // page: a single bad crop used to discard every formula on the image.
    let mut skipped: u32 = 0;

    for (i, region) in regions.into_iter().enumerate() {
        check_preannotation_cancelled()?;
        let crop = match geometry::crop_bounding_rect(&image, &region.points) {
            Ok(crop) => crop,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        check_preannotation_cancelled()?;
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
        check_preannotation_cancelled()?;
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
        });
    }

    Ok(PreannResult {
        boxes: out,
        skipped,
    })
}
