//! oarlabel Tauri command surface.

mod access;
mod devices;
mod export;
mod geometry;
mod menu;
mod models;
mod ocr;
mod pdf;
mod project;

use serde::Deserialize;
use tauri::menu::MenuEvent;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tracing_subscriber::EnvFilter;

/// Grouped pre-annotation parameters (mode + models + device), received as one
/// JSON object so the `preannotate` command stays under clippy's argument
/// limit. camelCase mirrors the TS field names (`ocrModel`, …).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreannParams {
    mode: String,
    ocr_model: String,
    layout_model: String,
    formula_model: String,
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
    #[serde(default)]
    auto_save: bool,
    #[serde(default)]
    recent_dirs: Vec<String>,
}

/// Parse a menu-rebuild event payload into (locale, ViewState). The backend is
/// deliberately strict here: invalid payloads must not silently rebuild the
/// native menu in another language.
fn parse_menu_payload(raw: &str) -> Result<(String, menu::ViewState), String> {
    let p = serde_json::from_str::<MenuPayload>(raw)
        .map_err(|e| format!("invalid native menu payload: {e}"))?;
    menu_payload_to_state(p)
}

fn menu_payload_to_state(p: MenuPayload) -> Result<(String, menu::ViewState), String> {
    let locale = normalize_locale(&p.locale)
        .ok_or_else(|| format!("invalid native menu locale: {}", p.locale))?;
    Ok((
        locale,
        menu::ViewState {
            view: p.view,
            theme: p.theme,
            ocr_model: p.ocr_model,
            layout_model: p.layout_model,
            formula_model: p.formula_model,
            device: p.device,
            auto_save: p.auto_save,
            recent_dirs: p.recent_dirs,
        },
    ))
}

fn normalize_locale(locale: &str) -> Option<String> {
    match locale.trim() {
        "zh-CN" => Some("zh-CN".into()),
        "en-US" => Some("en-US".into()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_menu_payload;

    #[test]
    fn parse_menu_payload_accepts_structured_payload() {
        let (locale, state) = parse_menu_payload(
            r#"{"locale":"en-US","view":{"fileList":false},"theme":"dark","ocrModel":"ppocrv6_tiny","layoutModel":"layout_doc_v3","formulaModel":"pp_formulanet_plus_s","device":"cpu","autoSave":true,"recentDirs":["/tmp/images"]}"#,
        )
        .expect("structured payload should parse");
        assert_eq!(locale, "en-US");
        assert_eq!(state.view.get("fileList"), Some(&false));
        assert_eq!(state.theme.as_deref(), Some("dark"));
        assert_eq!(state.device.as_deref(), Some("cpu"));
        assert!(state.auto_save);
        assert_eq!(state.recent_dirs, vec!["/tmp/images"]);
    }

    #[test]
    fn parse_menu_payload_rejects_legacy_string_locale() {
        assert!(parse_menu_payload("\"en-US\"").is_err());
        assert!(parse_menu_payload("en-US").is_err());
    }

    #[test]
    fn parse_menu_payload_rejects_unknown_locale() {
        let err = match parse_menu_payload(r#"{"locale":"fr-FR","view":{}}"#) {
            Ok(_) => panic!("unknown locale should be rejected"),
            Err(err) => err,
        };
        assert!(err.contains("invalid native menu locale"));
    }
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
fn list_images(
    app: AppHandle,
    access: State<'_, access::PathAccess>,
    dir: String,
) -> Result<Vec<project::ImageItem>, String> {
    let items = project::list_images(&dir)?;
    activate_image_workspace(&app, &access, items)
}

#[tauri::command]
fn image_items(
    app: AppHandle,
    access: State<'_, access::PathAccess>,
    paths: Vec<String>,
) -> Result<Vec<project::ImageItem>, String> {
    let items = project::image_items(&paths);
    activate_image_workspace(&app, &access, items)
}

fn activate_image_workspace(
    app: &AppHandle,
    access: &access::PathAccess,
    mut items: Vec<project::ImageItem>,
) -> Result<Vec<project::ImageItem>, String> {
    let paths = items
        .iter()
        .map(|item| item.path.clone())
        .collect::<Vec<_>>();
    let canonical = access.replace_images(&paths)?;
    let scope = app.asset_protocol_scope();
    for (item, path) in items.iter_mut().zip(canonical) {
        scope
            .allow_file(&path)
            .map_err(|e| format!("Failed to authorize image access: {e}"))?;
        item.path = path.to_string_lossy().into_owned();
    }
    Ok(items)
}

#[tauri::command]
async fn import_pdf(
    app: AppHandle,
    access: State<'_, access::PathAccess>,
    pdf_path: String,
) -> Result<Vec<project::ImageItem>, String> {
    let default_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("pdf-pages");
    // PDF pages always go to the application cache; the caller cannot select
    // an arbitrary write location.
    let items =
        tauri::async_runtime::spawn_blocking(move || pdf::import_pdf(&pdf_path, &default_root))
            .await
            .map_err(|e| format!("PDF import task failed: {e}"))??;
    activate_image_workspace(&app, &access, items)
}

#[tauri::command]
fn image_size(access: State<'_, access::PathAccess>, path: String) -> Result<(u32, u32), String> {
    let path = access.require_image(&path)?;
    project::image_size(&path.to_string_lossy())
}

#[tauri::command]
fn read_annotation(
    access: State<'_, access::PathAccess>,
    image_path: String,
) -> Result<Option<String>, String> {
    let path = access.require_image(&image_path)?;
    project::read_annotation(&path.to_string_lossy())
}

#[tauri::command]
fn save_annotation(
    access: State<'_, access::PathAccess>,
    image_path: String,
    data: String,
) -> Result<(), String> {
    let path = access.require_image(&image_path)?;
    project::save_annotation(&path.to_string_lossy(), &data)
}

#[tauri::command]
fn available_devices() -> Vec<devices::DeviceOption> {
    devices::available_devices()
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
    access: State<'_, access::PathAccess>,
    image_path: String,
    params: PreannParams,
) -> Result<ocr::PreannResult, String> {
    let image_path = access
        .require_image(&image_path)?
        .to_string_lossy()
        .into_owned();
    let PreannParams {
        mode,
        ocr_model,
        layout_model,
        formula_model,
        device,
        thresholds,
    } = params;

    let log_mode = mode.clone();
    let log_image_path = image_path.clone();
    let log_ocr_model = ocr_model.clone();
    let log_layout_model = layout_model.clone();
    let log_formula_model = formula_model.clone();
    let log_device = device.clone();
    tracing::info!(
        mode = %log_mode,
        image = %log_image_path,
        ocr_model = %log_ocr_model,
        layout_model = %log_layout_model,
        formula_model = %log_formula_model,
        device = %log_device,
        "preannotate started"
    );

    let result = tauri::async_runtime::spawn_blocking(move || {
        ocr::begin_preannotation_run();
        let result = match mode.as_str() {
            "ocr" => ocr::run_ocr(&app, &image_path, &ocr_model, &device, thresholds),
            "layout" => {
                ocr::run_layout(&app, &image_path, None, &layout_model, &device, thresholds)
            }
            "formula" => ocr::run_formula(
                &app,
                &image_path,
                &layout_model,
                &formula_model,
                &device,
                thresholds,
            ),
            other => Err(format!("Unknown mode: {other}")),
        };
        ocr::finish_preannotation_run();
        result
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
fn cancel_preannotation() {
    ocr::request_preannotation_cancel();
}

#[tauri::command]
async fn recognize_text_regions(
    app: AppHandle,
    access: State<'_, access::PathAccess>,
    image_path: String,
    params: TextRegionRecognitionParams,
) -> Result<ocr::TextRecognitionRegionResult, String> {
    let image_path = access
        .require_image(&image_path)?
        .to_string_lossy()
        .into_owned();
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
    access: State<'_, access::PathAccess>,
    image_path: String,
    params: FormulaRegionRecognitionParams,
) -> Result<ocr::TextRecognitionRegionResult, String> {
    let image_path = access
        .require_image(&image_path)?
        .to_string_lossy()
        .into_owned();
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
async fn pick_image_directory(app: AppHandle, title: String) -> Result<Option<String>, String> {
    Ok(pick_directory(app, title)
        .await?
        .map(|path| path.to_string_lossy().into_owned()))
}

async fn pick_directory(
    app: AppHandle,
    title: String,
) -> Result<Option<std::path::PathBuf>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title).blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Directory picker failed: {e}"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|e| format!("Invalid selected directory: {e}"))?;
    Ok(Some(selected))
}

#[tauri::command]
async fn pick_export_directory(
    app: AppHandle,
    access: State<'_, access::PathAccess>,
    title: String,
) -> Result<Option<String>, String> {
    let Some(selected) = pick_directory(app, title).await? else {
        return Ok(None);
    };
    let canonical = access.authorize_export_dir(&selected)?;
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn export_dataset(
    access: State<'_, access::PathAccess>,
    mut images: Vec<export::ExportImage>,
    out_dir: String,
    kind: String,
) -> Result<String, String> {
    let out_dir = access
        .require_export_dir(&out_dir)?
        .to_string_lossy()
        .into_owned();
    for image in &mut images {
        image.path = access
            .require_image(&image.path)?
            .to_string_lossy()
            .into_owned();
    }
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
        .manage(access::PathAccess::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            // Rebuild the menu (locale change or model-option change). Payload
            // is JSON: {"locale":"zh-CN","view":{"fileList":true,...}}. The
            // view map seeds the View checkbox items with their real checked
            // value so a rebuild never resets hidden panels to checked.
            #[cfg(target_os = "macos")]
            let handle = app.handle().clone();
            app.listen("oar:set-locale", move |event| {
                match parse_menu_payload(event.payload()) {
                    Ok((locale, state)) => {
                        #[cfg(target_os = "macos")]
                        menu::rebuild(&handle, &locale, &state);
                        let _ = (&locale, &state); // silence unused off-macOS
                    }
                    Err(e) => tracing::error!(error = %e, "native menu rebuild skipped"),
                }
            });

            #[cfg(target_os = "macos")]
            let handle = app.handle().clone();
            app.listen("oar:rebuild-menu", move |event| {
                match parse_menu_payload(event.payload()) {
                    Ok((locale, state)) => {
                        #[cfg(target_os = "macos")]
                        menu::rebuild(&handle, &locale, &state);
                        let _ = (&locale, &state); // silence unused off-macOS
                    }
                    Err(e) => tracing::error!(error = %e, "native menu rebuild skipped"),
                }
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

            // Keep native menu availability aligned with the React UI. The
            // frontend emits "item-id|true" whenever image/selection/history
            // or busy state changes.
            #[cfg(target_os = "macos")]
            let handle = app.handle().clone();
            app.listen("oar:set-menu-enabled", move |event| {
                if let Ok(payload) = serde_json::from_str::<String>(event.payload()) {
                    if let Some((item_id, value)) = payload.split_once('|') {
                        #[cfg(target_os = "macos")]
                        menu::set_enabled(&handle, item_id, value == "true");
                        let _ = (item_id, value);
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
            available_devices,
            model_status,
            model_options,
            read_custom_ocr_paths,
            save_custom_ocr_paths,
            preannotate,
            cancel_preannotation,
            recognize_text_regions,
            recognize_formula_regions,
            pick_image_directory,
            pick_export_directory,
            export_dataset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
