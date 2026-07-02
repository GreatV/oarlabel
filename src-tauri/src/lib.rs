//! oarlabel Tauri command surface.

mod export;
mod models;
mod ocr;
mod pdf;
mod project;

use tauri::{AppHandle, Manager};

#[tauri::command]
fn list_images(dir: String) -> Result<Vec<project::ImageItem>, String> {
    project::list_images(&dir)
}

#[tauri::command]
fn image_items(paths: Vec<String>) -> Vec<project::ImageItem> {
    project::image_items(&paths)
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
    tauri::async_runtime::spawn_blocking(move || {
        pdf::import_pdf(&pdf_path, &default_root, out_dir.as_deref())
    })
    .await
    .map_err(|e| format!("PDF 导入任务失败: {e}"))?
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
fn read_model_config(app: AppHandle) -> Result<String, String> {
    models::custom_config_text(&app)
}

#[tauri::command]
fn save_model_config(app: AppHandle, text: String) -> Result<(), String> {
    models::save_custom_config(&app, &text)
}

#[tauri::command]
async fn preannotate(
    app: AppHandle,
    image_path: String,
    mode: String,
    ocr_model: String,
    layout_model: String,
    formula_model: String,
    table_model: String,
    device: String,
) -> Result<Vec<ocr::PreannBox>, String> {
    tauri::async_runtime::spawn_blocking(move || match mode.as_str() {
        "ocr" | "reading" => ocr::run_ocr(&app, &image_path, &ocr_model, &device),
        "layout" => ocr::run_layout(&app, &image_path, None, &layout_model, &device),
        "table" => ocr::run_table(&app, &image_path, &layout_model, &table_model, &device),
        "formula" => ocr::run_formula(&app, &image_path, &layout_model, &formula_model, &device),
        other => Err(format!("未知模式: {other}")),
    })
    .await
    .map_err(|e| format!("预标注任务失败: {e}"))?
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
        other => Err(format!("未知导出类型: {other}")),
    })
    .await
    .map_err(|e| format!("导出任务失败: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            list_images,
            image_items,
            import_pdf,
            image_size,
            read_annotation,
            save_annotation,
            model_status,
            model_options,
            read_model_config,
            save_model_config,
            preannotate,
            export_dataset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
