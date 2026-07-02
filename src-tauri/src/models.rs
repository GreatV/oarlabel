//! Model registry loaded from JSON configuration.
//!
//! Built-in models live in `model-config.default.json`. Users can add or
//! override entries in the app-data `model-config.custom.json` file.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const DEFAULT_CONFIG_JSON: &str = include_str!("../model-config.default.json");
const CUSTOM_CONFIG_FILE: &str = "model-config.custom.json";

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum ModelSource {
    GitHubRelease,
    ModelScope,
    CustomUrl,
    Local,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum ModelKind {
    Det,
    Rec,
    Dict,
    Layout,
    Formula,
    FormulaTokenizer,
    TableStructure,
    TableDict,
}

impl ModelKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModelKind::Det => "det",
            ModelKind::Rec => "rec",
            ModelKind::Dict => "dict",
            ModelKind::Layout => "layout",
            ModelKind::Formula => "formula",
            ModelKind::FormulaTokenizer => "formula_tokenizer",
            ModelKind::TableStructure => "table_structure",
            ModelKind::TableDict => "table_dict",
        }
    }
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
    pub sha256: String,
    #[serde(default)]
    pub bytes: u64,
    pub source: ModelSource,
    #[serde(default)]
    pub url: Option<String>,
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
}

#[derive(Clone, Deserialize, Serialize)]
pub struct FormulaProfile {
    pub key: String,
    pub title: String,
    pub model: String,
    pub tokenizer: String,
    pub model_name: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct TableProfile {
    pub key: String,
    pub title: String,
    pub structure: String,
    pub dict: String,
    pub model_name: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ModelConfig {
    pub version: u32,
    pub release_base: String,
    pub modelscope_repo: String,
    pub modelscope_revision: String,
    pub models: Vec<ModelDef>,
    pub ocr_profiles: Vec<OcrProfile>,
    pub formula_profiles: Vec<FormulaProfile>,
    pub table_profiles: Vec<TableProfile>,
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
    pub table_profiles: Vec<ModelOption>,
}

impl ModelConfig {
    fn merge(&mut self, custom: ModelConfig) {
        if !custom.release_base.is_empty() {
            self.release_base = custom.release_base;
        }
        if !custom.modelscope_repo.is_empty() {
            self.modelscope_repo = custom.modelscope_repo;
        }
        if !custom.modelscope_revision.is_empty() {
            self.modelscope_revision = custom.modelscope_revision;
        }
        merge_by_key(&mut self.models, custom.models, |m| &m.key);
        merge_by_key(&mut self.ocr_profiles, custom.ocr_profiles, |p| &p.key);
        merge_by_key(&mut self.formula_profiles, custom.formula_profiles, |p| {
            &p.key
        });
        merge_by_key(&mut self.table_profiles, custom.table_profiles, |p| &p.key);
    }

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
                ModelSource::GitHubRelease | ModelSource::ModelScope => {
                    if m.filename.is_empty() {
                        return Err(format!("Model filename cannot be empty: {}", m.key));
                    }
                    if m.sha256.is_empty() || m.bytes == 0 {
                        return Err(format!("Download model missing hash or size: {}", m.key));
                    }
                }
                ModelSource::CustomUrl => {
                    if m.url.as_deref().unwrap_or("").is_empty() {
                        return Err(format!("CustomUrl model missing url: {}", m.key));
                    }
                    if m.filename.is_empty() {
                        return Err(format!("CustomUrl model missing filename: {}", m.key));
                    }
                    if m.sha256.is_empty() || m.bytes == 0 {
                        return Err(format!("CustomUrl model missing hash or size: {}", m.key));
                    }
                }
                ModelSource::Local if m.path.as_deref().unwrap_or("").is_empty() => {
                    return Err(format!("Local model missing path: {}", m.key));
                }
                _ => {}
            }
        }

        for p in &self.ocr_profiles {
            require_model(&keys, &p.det, &p.key)?;
            require_model(&keys, &p.rec, &p.key)?;
            require_model(&keys, &p.dict, &p.key)?;
        }
        for p in &self.formula_profiles {
            require_model(&keys, &p.model, &p.key)?;
            require_model(&keys, &p.tokenizer, &p.key)?;
        }
        for p in &self.table_profiles {
            require_model(&keys, &p.structure, &p.key)?;
            require_model(&keys, &p.dict, &p.key)?;
        }
        Ok(())
    }
}

fn merge_by_key<T, F>(base: &mut Vec<T>, incoming: Vec<T>, key: F)
where
    F: Fn(&T) -> &String,
{
    for item in incoming {
        let item_key = key(&item).clone();
        if let Some(pos) = base.iter().position(|existing| key(existing) == &item_key) {
            base[pos] = item;
        } else {
            base.push(item);
        }
    }
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

fn custom_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(CUSTOM_CONFIG_FILE))
}

pub fn custom_config_text(app: &AppHandle) -> Result<String, String> {
    let path = custom_config_path(app)?;
    if path.is_file() {
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Ok(empty_custom_config())
    }
}

pub fn save_custom_config(app: &AppHandle, text: &str) -> Result<(), String> {
    let custom: ModelConfig = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let mut merged = default_config()?;
    merged.merge(custom);
    merged.validate()?;
    let path = custom_config_path(app)?;
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    clear_cache();
    Ok(())
}

fn empty_custom_config() -> String {
    serde_json::json!({
        "version": 1,
        "release_base": "",
        "modelscope_repo": "",
        "modelscope_revision": "",
        "models": [],
        "ocr_profiles": [],
        "formula_profiles": [],
        "table_profiles": []
    })
    .to_string()
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
    let custom_path = custom_config_path(app)?;
    let cache = CONFIG_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache.lock().map_err(|e| e.to_string())?;
    if let Some(cached) = guard.get(&custom_path) {
        return Ok(cached.clone());
    }

    let mut cfg = default_config()?;
    if custom_path.is_file() {
        let text = std::fs::read_to_string(&custom_path).map_err(|e| e.to_string())?;
        let custom: ModelConfig = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        cfg.merge(custom);
    }
    cfg.validate()?;
    guard.insert(custom_path, cfg.clone());
    Ok(cfg)
}

pub fn profile(app: &AppHandle, key: &str) -> Result<OcrProfile, String> {
    config(app)?
        .ocr_profiles
        .into_iter()
        .find(|p| p.key == key)
        .ok_or_else(|| format!("未知 OCR 模型档位: {key}"))
}

pub fn formula_profile(app: &AppHandle, key: &str) -> Result<FormulaProfile, String> {
    config(app)?
        .formula_profiles
        .into_iter()
        .find(|p| p.key == key)
        .ok_or_else(|| format!("未知公式识别模型: {key}"))
}

pub fn table_profile(app: &AppHandle, key: &str) -> Result<TableProfile, String> {
    config(app)?
        .table_profiles
        .into_iter()
        .find(|p| p.key == key)
        .ok_or_else(|| format!("未知表格识别模型: {key}"))
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
        ModelSource::Local | ModelSource::CustomUrl => false,
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
        table_profiles: cfg
            .table_profiles
            .iter()
            .map(|p| ModelOption {
                key: p.key.clone(),
                title: p.title.clone(),
            })
            .collect(),
    })
}
