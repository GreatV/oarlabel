//! oarlabel Tauri command surface.

mod export;
mod menu;
mod models;
mod ocr;
mod pdf;
mod project;

use serde::Deserialize;
use tauri::menu::MenuEvent;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_opener::OpenerExt;
use tracing_subscriber::EnvFilter;

/// Grouped pre-annotation parameters (mode + models + device), received as one
/// JSON object so the `preannotate` command stays under clippy's argument
/// limit. camelCase mirrors the TS field names (`ocrModel`, …).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreannParams {
    mode: String,
    /// Active annotation modes for the structured pipeline. Only consulted
    /// when `mode == "structure"`; ignored by the single-mode runs.
    #[serde(default)]
    modes: Vec<String>,
    ocr_model: String,
    layout_model: String,
    formula_model: String,
    table_model: String,
    device: String,
    #[serde(default)]
    thresholds: Option<models::InferenceTuning>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextRegionRecognitionParams {
    ocr_model: String,
    device: String,
    regions: Vec<ocr::TextRegionInput>,
    #[serde(default)]
    thresholds: Option<models::InferenceTuning>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormulaRegionRecognitionParams {
    formula_model: String,
    device: String,
    regions: Vec<ocr::TextRegionInput>,
}

/// Payload for `oar:set-locale` / `oar:rebuild-menu`: the locale plus the view
/// map used to seed the native View checkbox items at build time.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MenuPayload {
    locale: String,
    view: std::collections::HashMap<String, bool>,
    #[serde(default)]
    theme: Option<String>,
    #[serde(default)]
    ocr_model: Option<String>,
    #[serde(default)]
    layout_model: Option<String>,
    #[serde(default)]
    formula_model: Option<String>,
    #[serde(default)]
    device: Option<String>,
}

/// Parse a menu-rebuild event payload into (locale, ViewState). Accepts the
/// structured `{"locale","view"}` shape; if parsing fails (e.g. a legacy bare
/// locale string), fall back to the payload-as-locale with default (all-true)
/// view state so a rebuild never breaks.
fn parse_menu_payload(raw: &str) -> (String, menu::ViewState) {
    if let Ok(p) = serde_json::from_str::<MenuPayload>(raw) {
        return menu_payload_to_state(p);
    }
    ("zh-CN".into(), menu::ViewState::default())
}

fn menu_payload_to_state(p: MenuPayload) -> (String, menu::ViewState) {
    (
        p.locale,
        menu::ViewState {
            view: p.view,
            theme: p.theme,
            ocr_model: p.ocr_model,
            layout_model: p.layout_model,
            formula_model: p.formula_model,
            device: p.device,
        },
    )
}

fn init_logging() {
    static INIT: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    INIT.get_or_init(|| {
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("warn,oarlabel=info,oarlabel_lib=info,oar_ocr=info,oar_ocr_core=info")
        });
        if let Err(e) = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .compact()
            .try_init()
        {
            eprintln!("failed to initialize logging: {e}");
        }
    });
}

#[tauri::command]
fn list_images(app: AppHandle, dir: String) -> Result<Vec<project::ImageItem>, String> {
    // Validate first, authorize only on success. list_images checks is_dir and
    // returns a sorted image list; we only ever widen the asset scope for a
    // folder that actually exists and that the user explicitly opened, never
    // for an arbitrary string.
    let items = project::list_images(&dir)?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| format!("Failed to authorize directory access: {e}"))?;
    Ok(items)
}

#[tauri::command]
fn image_items(app: AppHandle, paths: Vec<String>) -> Vec<project::ImageItem> {
    // Validate first (is_file + is_image, inside project::image_items), then
    // authorize only the confirmed image files — never the raw input strings,
    // which could be arbitrary paths a compromised frontend passes in.
    let items = project::image_items(&paths);
    let scope = app.asset_protocol_scope();
    for it in &items {
        let _ = scope.allow_file(&it.path);
    }
    items
}

#[tauri::command]
async fn import_pdf(
    app: AppHandle,
    pdf_path: String,
    out_dir: Option<String>,
) -> Result<Vec<project::ImageItem>, String> {
    let default_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("pdf-pages");
    // Render first (this also validates pdf_path and creates the page dir),
    // then authorize only the concrete page directory that now exists — never
    // an unvalidated caller-supplied out_dir.
    let items = tauri::async_runtime::spawn_blocking(move || {
        pdf::import_pdf(&pdf_path, &default_root, out_dir.as_deref())
    })
    .await
    .map_err(|e| format!("PDF import task failed: {e}"))??;

    if let Some(first) = items.first() {
        if let Some(parent) = std::path::Path::new(&first.path).parent() {
            let _ = app.asset_protocol_scope().allow_directory(parent, true);
        }
    }
    Ok(items)
}

#[tauri::command]
fn image_size(path: String) -> Result<(u32, u32), String> {
    project::image_size(&path)
}

#[tauri::command]
fn read_annotation(image_path: String) -> Result<Option<String>, String> {
    project::read_annotation(&image_path)
}

#[tauri::command]
fn save_annotation(image_path: String, data: String) -> Result<(), String> {
    project::save_annotation(&image_path, &data)
}

#[tauri::command]
fn model_status(app: AppHandle) -> Result<Vec<models::ModelStatus>, String> {
    models::status_all(&app)
}

#[tauri::command]
fn model_options(app: AppHandle) -> Result<models::ModelOptions, String> {
    models::options(&app)
}

#[tauri::command]
fn read_custom_ocr_paths(app: AppHandle) -> Result<models::CustomOcrPaths, String> {
    models::custom_ocr_paths(&app)
}

#[tauri::command]
fn save_custom_ocr_paths(app: AppHandle, paths: models::CustomOcrPaths) -> Result<(), String> {
    models::save_custom_ocr_paths(&app, paths)
}

#[tauri::command]
async fn preannotate(
    app: AppHandle,
    image_path: String,
    params: PreannParams,
) -> Result<ocr::PreannResult, String> {
    let PreannParams {
        mode,
        modes,
        ocr_model,
        layout_model,
        formula_model,
        table_model,
        device,
        thresholds,
    } = params;

    let log_mode = mode.clone();
    let log_image_path = image_path.clone();
    let log_ocr_model = ocr_model.clone();
    let log_layout_model = layout_model.clone();
    let log_formula_model = formula_model.clone();
    let log_table_model = table_model.clone();
    let log_device = device.clone();
    tracing::info!(
        mode = %log_mode,
        image = %log_image_path,
        ocr_model = %log_ocr_model,
        layout_model = %log_layout_model,
        formula_model = %log_formula_model,
        table_model = %log_table_model,
        device = %log_device,
        "preannotate started"
    );

    let result = tauri::async_runtime::spawn_blocking(move || match mode.as_str() {
        "ocr" => ocr::run_ocr(&app, &image_path, &ocr_model, &device, thresholds),
        // reading-order mode: OCR plus a per-box position index (oar-ocr already
        // returns regions in reading order; run_reading_order attaches the index).
        "reading" => ocr::run_reading_order(&app, &image_path, &ocr_model, &device, thresholds),
        "layout" => ocr::run_layout(&app, &image_path, None, &layout_model, &device, thresholds),
        "table" => ocr::run_table(
            &app,
            &image_path,
            &layout_model,
            &table_model,
            &device,
            thresholds,
        ),
        "formula" => ocr::run_formula(
            &app,
            &image_path,
            &layout_model,
            &formula_model,
            &device,
            thresholds,
        ),
        // Structured pipeline: layout regions as parents, with recognition
        // results (ocr/formula/table/reading) attached as children. Which
        // recognizers run is decided by the active `modes`.
        "structure" => ocr::run_structure(
            &app,
            &image_path,
            &modes,
            ocr::StructureRunConfig {
                layout_key: &layout_model,
                ocr_key: &ocr_model,
                formula_key: &formula_model,
                table_key: &table_model,
                device: &device,
                tuning: thresholds,
            },
        ),
        other => Err(format!("Unknown mode: {other}")),
    })
    .await
    .map_err(|e| format!("Pre-annotation task failed: {e}"))?;
    match &result {
        Ok(value) => tracing::info!(
            mode = %log_mode,
            boxes = value.boxes.len(),
            skipped = value.skipped,
            "preannotate finished"
        ),
        Err(e) => tracing::error!(mode = %log_mode, error = %e, "preannotate failed"),
    }
    result
}

#[tauri::command]
async fn recognize_text_regions(
    app: AppHandle,
    image_path: String,
    params: TextRegionRecognitionParams,
) -> Result<ocr::TextRecognitionRegionResult, String> {
    let TextRegionRecognitionParams {
        ocr_model,
        device,
        regions,
        thresholds,
    } = params;
    let log_image_path = image_path.clone();
    let log_ocr_model = ocr_model.clone();
    let log_device = device.clone();
    let region_count = regions.len();
    tracing::info!(
        image = %log_image_path,
        ocr_model = %log_ocr_model,
        device = %log_device,
        regions = region_count,
        "text region recognition started"
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        ocr::recognize_text_regions(&app, &image_path, &ocr_model, &device, regions, thresholds)
    })
    .await
    .map_err(|e| format!("Text recognition task failed: {e}"))?;
    match &result {
        Ok(value) => tracing::info!(
            regions = value.regions.len(),
            skipped = value.skipped,
            "text region recognition finished"
        ),
        Err(e) => tracing::error!(error = %e, "text region recognition failed"),
    }
    result
}

#[tauri::command]
async fn recognize_formula_regions(
    app: AppHandle,
    image_path: String,
    params: FormulaRegionRecognitionParams,
) -> Result<ocr::TextRecognitionRegionResult, String> {
    let FormulaRegionRecognitionParams {
        formula_model,
        device,
        regions,
    } = params;
    let log_image_path = image_path.clone();
    let log_formula_model = formula_model.clone();
    let log_device = device.clone();
    let region_count = regions.len();
    tracing::info!(
        image = %log_image_path,
        formula_model = %log_formula_model,
        device = %log_device,
        regions = region_count,
        "formula region recognition started"
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        ocr::recognize_formula_regions(&app, &image_path, &formula_model, &device, regions)
    })
    .await
    .map_err(|e| format!("Formula recognition task failed: {e}"))?;
    match &result {
        Ok(value) => tracing::info!(
            regions = value.regions.len(),
            skipped = value.skipped,
            "formula region recognition finished"
        ),
        Err(e) => tracing::error!(error = %e, "formula region recognition failed"),
    }
    result
}

#[tauri::command]
async fn export_dataset(
    images: Vec<export::ExportImage>,
    out_dir: String,
    kind: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "detection" => export::export_detection(&images, &out_dir),
        "recognition" => export::export_recognition(&images, &out_dir),
        other => Err(format!("Unknown export type: {other}")),
    })
    .await
    .map_err(|e| format!("Export task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Native menu items forward their id to the frontend as `oar:<id>`
        // events; predefined items (Cut/Copy/Paste/Quit/…) are OS-handled.
        .on_menu_event(|app, event: MenuEvent| {
            let id = event.id().as_ref();
            // Help links open in the browser directly from Rust (no need to
            // round-trip through the frontend).
            if let Some(which) = id.strip_prefix("oar:help:") {
                let repo = "https://github.com/GreatV/oar-ocr";
                let url = match which {
                    "docs" => format!("{repo}/blob/master/docs/usage.md"),
                    "faq" => format!("{repo}#readme"),
                    "feedback" => format!("{repo}/issues"),
                    "update" => format!("{repo}/releases"),
                    _ => return,
                };
                let _ = app.opener().open_url(url, None::<&str>);
                return;
            }
            // Model selection: emit a single stable umbrella event carrying the
            // concrete model id as payload, so the frontend needs only ONE
            // listener (registered up front) regardless of when model options
            // load or how often the menu is rebuilt. Previously each model id
            // needed its own listener, so clicks before options loaded no-op'd.
            if let Some(rest) = id.strip_prefix("oar:model:") {
                let _ = app.emit("oar:model-select", rest);
                return;
            }
            if let Some(theme) = id.strip_prefix("oar:theme:") {
                menu::set_theme_checked(app, theme);
                let _ = app.emit(id, ());
                return;
            }
            if id.starts_with("oar:") {
                let _ = app.emit(id, ());
            }
        })
        .setup(|app| {
            // The menu is built here (not in a `.menu()` builder closure)
            // because building it needs `models::options(app)`, which reads
            // the app-data dir via `app.path()` — and that state isn't
            // available until setup. macOS only; off-macOS rebuild() is a
            // no-op and the in-window MenuBar.tsx remains the UI. The default
            // locale is zh-CN; the frontend re-triggers rebuild on its real
            // initial locale right after mount.
            #[cfg(target_os = "macos")]
            menu::rebuild(app.handle(), "zh-CN", &menu::ViewState::default());

            // Rebuild the menu (locale change or model-option change). Payload
            // is JSON: {"locale":"zh-CN","view":{"fileList":true,...}}. The
            // view map seeds the View checkbox items with their real checked
            // value so a rebuild never resets hidden panels to checked.
            #[cfg(target_os = "macos")]
            let handle = app.handle().clone();
            app.listen("oar:set-locale", move |event| {
                let (locale, state) = parse_menu_payload(event.payload());
                #[cfg(target_os = "macos")]
                menu::rebuild(&handle, &locale, &state);
                let _ = (&locale, &state); // silence unused off-macOS
            });

            #[cfg(target_os = "macos")]
            let handle = app.handle().clone();
            app.listen("oar:rebuild-menu", move |event| {
                let (locale, state) = parse_menu_payload(event.payload());
                #[cfg(target_os = "macos")]
                menu::rebuild(&handle, &locale, &state);
                let _ = (&locale, &state); // silence unused off-macOS
            });

            // The frontend tells us when a View checkbox should flip so the
            // native item stays in sync with the React `view` state.
            #[cfg(target_os = "macos")]
            let handle = app.handle().clone();
            app.listen("oar:set-menu-state", move |event| {
                if let Some(payload) = event
                    .payload()
                    .strip_prefix('"')
                    .and_then(|s| s.strip_suffix('"'))
                {
                    // payload like "oar:view:fileList|true"
                    if let Some((item_id, val)) = payload.split_once('|') {
                        #[cfg(target_os = "macos")]
                        menu::set_checked(&handle, item_id, val == "true");
                        let _ = (item_id, val);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_images,
            image_items,
            import_pdf,
            image_size,
            read_annotation,
            save_annotation,
            model_status,
            model_options,
            read_custom_ocr_paths,
            save_custom_ocr_paths,
            preannotate,
            recognize_text_regions,
            recognize_formula_regions,
            export_dataset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
