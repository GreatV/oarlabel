//! Model registry loaded from JSON configuration.
//!
//! Built-in models live in `model-config.default.json`. Users may add one
//! local OCR profile by selecting text detection / recognition / dictionary
//! paths in the settings dialog.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const DEFAULT_CONFIG_JSON: &str = include_str!("../model-config.default.json");
const CUSTOM_OCR_FILE: &str = "custom-ocr-model.json";
const CUSTOM_OCR_PROFILE_KEY: &str = "custom_text_ocr";
const CUSTOM_DET_KEY: &str = "custom_text_detection";
const CUSTOM_REC_KEY: &str = "custom_text_recognition";
const CUSTOM_DICT_KEY: &str = "custom_text_recognition_dict";

pub const TEXT_LINE_ORIENTATION_MODEL_KEY: &str = "pp_lcnet_x1_0_textline_ori";

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum ModelSource {
    GitHubRelease,
    ModelScope,
    Local,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum ModelKind {
    Det,
    Rec,
    Dict,
    TextLineOrientation,
    Layout,
    Formula,
    FormulaTokenizer,
}

impl ModelKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModelKind::Det => "det",
            ModelKind::Rec => "rec",
            ModelKind::Dict => "dict",
            ModelKind::TextLineOrientation => "text_line_orientation",
            ModelKind::Layout => "layout",
            ModelKind::Formula => "formula",
            ModelKind::FormulaTokenizer => "formula_tokenizer",
        }
    }
}

/// Catalog entry for a single model file.
///
/// The app does not download models itself. For `GitHubRelease` / `ModelScope`
/// sources, the model is resolved by `filename` through oar-ocr's
/// `auto-download` cache (see `resolve`/`present`); for `Local` it is read
/// straight from `path`. Only fields that actually drive resolution are kept
/// here — hash/size/URL metadata was previously present but never used, so it
/// has been removed to avoid implying download behavior that didn't exist.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct TextDetectionTuning {
    #[serde(default)]
    pub score_threshold: Option<f32>,
    #[serde(default)]
    pub box_threshold: Option<f32>,
    #[serde(default)]
    pub unclip_ratio: Option<f32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct TextRecognitionTuning {
    #[serde(default)]
    pub score_threshold: Option<f32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct LayoutDetectionTuning {
    #[serde(default)]
    pub score_threshold: Option<f32>,
    #[serde(default)]
    pub nms_threshold: Option<f32>,
    #[serde(default)]
    pub max_elements: Option<usize>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct InferenceTuning {
    #[serde(default)]
    pub ocr: Option<TextDetectionTuning>,
    #[serde(default)]
    pub text_recognition: Option<TextRecognitionTuning>,
    #[serde(default)]
    pub layout: Option<LayoutDetectionTuning>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ModelDef {
    pub key: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub size_label: String,
    pub title: String,
    #[serde(default)]
    pub bundled: bool,
    pub kind: ModelKind,
    #[serde(default)]
    pub pipeline_name: Option<String>,
    #[serde(default)]
    pub layout_detection: Option<LayoutDetectionTuning>,
    pub source: ModelSource,
    /// Absolute path for `Local` models; ignored otherwise.
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct OcrProfile {
    pub key: String,
    pub title: String,
    pub det: String,
    pub rec: String,
    pub dict: String,
    #[serde(default)]
    pub text_detection: Option<TextDetectionTuning>,
    #[serde(default)]
    pub text_recognition: Option<TextRecognitionTuning>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct FormulaProfile {
    pub key: String,
    pub title: String,
    pub model: String,
    pub tokenizer: String,
    pub model_name: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomOcrPaths {
    #[serde(default)]
    pub text_detection_model_path: String,
    #[serde(default)]
    pub text_recognition_model_path: String,
    #[serde(default)]
    pub text_recognition_dict_path: String,
}

impl CustomOcrPaths {
    fn trimmed(self) -> Self {
        Self {
            text_detection_model_path: self.text_detection_model_path.trim().to_string(),
            text_recognition_model_path: self.text_recognition_model_path.trim().to_string(),
            text_recognition_dict_path: self.text_recognition_dict_path.trim().to_string(),
        }
    }

    fn has_any(&self) -> bool {
        !self.text_detection_model_path.is_empty()
            || !self.text_recognition_model_path.is_empty()
            || !self.text_recognition_dict_path.is_empty()
    }

    fn is_complete(&self) -> bool {
        !self.text_detection_model_path.is_empty()
            && !self.text_recognition_model_path.is_empty()
            && !self.text_recognition_dict_path.is_empty()
    }
}

/// Top-level model registry. Built-in entries ship in
/// `model-config.default.json`; users can optionally add one local text OCR
/// profile from the app-data `custom-ocr-model.json`. Model file resolution & download is delegated to
/// oar-ocr's `auto-download`, so this config only carries catalog metadata and
/// profile wiring (no per-model download URLs).
#[derive(Clone, Deserialize, Serialize)]
pub struct ModelConfig {
    pub version: u32,
    pub models: Vec<ModelDef>,
    pub ocr_profiles: Vec<OcrProfile>,
    pub formula_profiles: Vec<FormulaProfile>,
}

#[derive(Serialize)]
pub struct ModelOption {
    pub key: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct ModelOptions {
    pub ocr_profiles: Vec<ModelOption>,
    pub layout_models: Vec<ModelOption>,
    pub formula_profiles: Vec<ModelOption>,
}

impl ModelConfig {
    fn validate(&self) -> Result<(), String> {
        let mut keys = HashSet::new();
        for m in &self.models {
            if m.key.is_empty() {
                return Err("Model key cannot be empty".into());
            }
            if m.title.is_empty() {
                return Err(format!("Model title cannot be empty: {}", m.key));
            }
            if !keys.insert(m.key.as_str()) {
                return Err(format!("Duplicate model key: {}", m.key));
            }
            match m.source {
                // Remote models are resolved/downloaded by oar-ocr keyed on the
                // bare filename, so that's the only field we can validate here.
                ModelSource::GitHubRelease | ModelSource::ModelScope if m.filename.is_empty() => {
                    return Err(format!("Model filename cannot be empty: {}", m.key));
                }
                ModelSource::Local if m.path.as_deref().unwrap_or("").is_empty() => {
                    return Err(format!("Local model missing path: {}", m.key));
                }
                _ => {}
            }
            if let Some(tuning) = m.layout_detection {
                validate_layout_tuning(tuning, &m.key)?;
            }
        }

        for p in &self.ocr_profiles {
            require_model(&keys, &p.det, &p.key)?;
            require_model(&keys, &p.rec, &p.key)?;
            require_model(&keys, &p.dict, &p.key)?;
            if let Some(tuning) = p.text_detection {
                validate_text_tuning(tuning, &p.key)?;
            }
            if let Some(tuning) = p.text_recognition {
                validate_text_recognition_tuning(tuning, &p.key)?;
            }
        }
        for p in &self.formula_profiles {
            require_model(&keys, &p.model, &p.key)?;
            require_model(&keys, &p.tokenizer, &p.key)?;
        }
        Ok(())
    }
}

fn validate_unit(name: &str, value: Option<f32>, owner: &str) -> Result<(), String> {
    if let Some(v) = value {
        if !(0.0..=1.0).contains(&v) {
            return Err(format!("{owner}.{name} must be between 0 and 1"));
        }
    }
    Ok(())
}

fn validate_text_tuning(tuning: TextDetectionTuning, owner: &str) -> Result<(), String> {
    validate_unit("score_threshold", tuning.score_threshold, owner)?;
    validate_unit("box_threshold", tuning.box_threshold, owner)?;
    if let Some(v) = tuning.unclip_ratio {
        if v < 0.0 {
            return Err(format!("{owner}.unclip_ratio must be >= 0"));
        }
    }
    Ok(())
}

fn validate_text_recognition_tuning(
    tuning: TextRecognitionTuning,
    owner: &str,
) -> Result<(), String> {
    validate_unit("score_threshold", tuning.score_threshold, owner)?;
    Ok(())
}

fn validate_layout_tuning(tuning: LayoutDetectionTuning, owner: &str) -> Result<(), String> {
    validate_unit("score_threshold", tuning.score_threshold, owner)?;
    validate_unit("nms_threshold", tuning.nms_threshold, owner)?;
    if let Some(v) = tuning.max_elements {
        if v == 0 {
            return Err(format!("{owner}.max_elements must be >= 1"));
        }
    }
    Ok(())
}

fn require_model(keys: &HashSet<&str>, model_key: &str, profile_key: &str) -> Result<(), String> {
    if keys.contains(model_key) {
        Ok(())
    } else {
        Err(format!(
            "Profile {profile_key} references unknown model: {model_key}"
        ))
    }
}

fn default_config() -> Result<ModelConfig, String> {
    serde_json::from_str(DEFAULT_CONFIG_JSON).map_err(|e| e.to_string())
}

fn custom_ocr_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(CUSTOM_OCR_FILE))
}

pub fn custom_ocr_paths(app: &AppHandle) -> Result<CustomOcrPaths, String> {
    let path = custom_ocr_path(app)?;
    if path.is_file() {
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str::<CustomOcrPaths>(&text)
            .map(|paths| paths.trimmed())
            .map_err(|e| e.to_string())
    } else {
        Ok(CustomOcrPaths::default())
    }
}

pub fn save_custom_ocr_paths(app: &AppHandle, paths: CustomOcrPaths) -> Result<(), String> {
    let paths = paths.trimmed();
    let path = custom_ocr_path(app)?;
    if !paths.has_any() {
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        clear_cache();
        return Ok(());
    }

    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&paths).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    clear_cache();
    Ok(())
}

fn custom_ocr_files_exist(paths: &CustomOcrPaths) -> bool {
    [
        paths.text_detection_model_path.as_str(),
        paths.text_recognition_model_path.as_str(),
        paths.text_recognition_dict_path.as_str(),
    ]
    .into_iter()
    .all(|value| PathBuf::from(value).is_file())
}

fn local_model(key: &str, title: &str, kind: ModelKind, path: &str) -> ModelDef {
    let filename = PathBuf::from(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    ModelDef {
        key: key.into(),
        filename,
        size_label: String::new(),
        title: title.into(),
        bundled: false,
        kind,
        pipeline_name: None,
        layout_detection: None,
        source: ModelSource::Local,
        path: Some(path.into()),
    }
}

fn append_custom_ocr_profile(cfg: &mut ModelConfig, paths: CustomOcrPaths) {
    if !paths.is_complete() || !custom_ocr_files_exist(&paths) {
        return;
    }
    cfg.models.push(local_model(
        CUSTOM_DET_KEY,
        "Custom text detection model",
        ModelKind::Det,
        &paths.text_detection_model_path,
    ));
    cfg.models.push(local_model(
        CUSTOM_REC_KEY,
        "Custom text recognition model",
        ModelKind::Rec,
        &paths.text_recognition_model_path,
    ));
    cfg.models.push(local_model(
        CUSTOM_DICT_KEY,
        "Custom text recognition dictionary",
        ModelKind::Dict,
        &paths.text_recognition_dict_path,
    ));
    cfg.ocr_profiles.push(OcrProfile {
        key: CUSTOM_OCR_PROFILE_KEY.into(),
        title: "Custom text OCR".into(),
        det: CUSTOM_DET_KEY.into(),
        rec: CUSTOM_REC_KEY.into(),
        dict: CUSTOM_DICT_KEY.into(),
        text_detection: None,
        text_recognition: None,
    });
}

static CONFIG_CACHE: OnceLock<Mutex<HashMap<PathBuf, ModelConfig>>> = OnceLock::new();

fn clear_cache() {
    if let Some(cache) = CONFIG_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            guard.clear();
        }
    }
}

pub fn config(app: &AppHandle) -> Result<ModelConfig, String> {
    let custom_path = custom_ocr_path(app)?;
    let cache = CONFIG_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache.lock().map_err(|e| e.to_string())?;
    if let Some(cached) = guard.get(&custom_path) {
        return Ok(cached.clone());
    }

    let mut cfg = default_config()?;
    append_custom_ocr_profile(&mut cfg, custom_ocr_paths(app)?);
    cfg.validate()?;
    guard.insert(custom_path, cfg.clone());
    Ok(cfg)
}

pub fn profile(app: &AppHandle, key: &str) -> Result<OcrProfile, String> {
    config(app)?
        .ocr_profiles
        .into_iter()
        .find(|p| p.key == key)
        .ok_or_else(|| format!("Unknown OCR profile: {key}"))
}

pub fn formula_profile(app: &AppHandle, key: &str) -> Result<FormulaProfile, String> {
    config(app)?
        .formula_profiles
        .into_iter()
        .find(|p| p.key == key)
        .ok_or_else(|| format!("Unknown formula recognition model: {key}"))
}

pub fn def(app: &AppHandle, key: &str) -> Result<ModelDef, String> {
    config(app)?
        .models
        .into_iter()
        .find(|m| m.key == key)
        .ok_or_else(|| format!("Unknown model: {key}"))
}

fn candidate_paths(app: &AppHandle, d: &ModelDef) -> Vec<PathBuf> {
    if let ModelSource::Local = d.source {
        return d.path.iter().map(PathBuf::from).collect();
    }

    let mut v = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        v.push(res.join("models").join(&d.filename));
    }
    v.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join(&d.filename),
    );
    v
}

pub fn resolve(app: &AppHandle, key: &str) -> Option<PathBuf> {
    let d = def(app, key).ok()?;
    if let Some(path) = candidate_paths(app, &d).into_iter().find(|p| p.is_file()) {
        return Some(path);
    }
    match d.source {
        ModelSource::Local => None,
        _ => Some(PathBuf::from(d.filename)),
    }
}

fn present(app: &AppHandle, d: &ModelDef) -> bool {
    if candidate_paths(app, d).into_iter().any(|p| p.is_file()) {
        return true;
    }
    match d.source {
        ModelSource::Local => false,
        ModelSource::GitHubRelease | ModelSource::ModelScope => {
            oar_ocr::download::cache_dir().join(&d.filename).is_file()
        }
    }
}

#[derive(Serialize)]
pub struct ModelStatus {
    pub key: String,
    pub filename: String,
    pub title: String,
    pub size_label: String,
    pub bundled: bool,
    pub present: bool,
    pub kind: String,
}

pub fn status_all(app: &AppHandle) -> Result<Vec<ModelStatus>, String> {
    let cfg = config(app)?;
    Ok(cfg
        .models
        .iter()
        .map(|d| ModelStatus {
            key: d.key.clone(),
            filename: d.filename.clone(),
            title: d.title.clone(),
            size_label: d.size_label.clone(),
            bundled: d.bundled,
            present: present(app, d),
            kind: d.kind.as_str().into(),
        })
        .collect())
}

pub fn options(app: &AppHandle) -> Result<ModelOptions, String> {
    let cfg = config(app)?;
    Ok(ModelOptions {
        ocr_profiles: cfg
            .ocr_profiles
            .iter()
            .map(|p| ModelOption {
                key: p.key.clone(),
                title: p.title.clone(),
            })
            .collect(),
        layout_models: cfg
            .models
            .iter()
            .filter(|m| m.kind == ModelKind::Layout)
            .map(|m| ModelOption {
                key: m.key.clone(),
                title: m.title.clone(),
            })
            .collect(),
        formula_profiles: cfg
            .formula_profiles
            .iter()
            .map(|p| ModelOption {
                key: p.key.clone(),
                title: p.title.clone(),
            })
            .collect(),
    })
}
