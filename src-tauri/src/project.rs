//! Project / workspace IO: listing images in a folder, probing image size, and
//! persisting one annotation JSON next to each image.

use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct ImageItem {
    pub path: String,
    pub name: String,
}

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "bmp", "webp", "gif", "tif", "tiff"];

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn image_item(path: &Path) -> ImageItem {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    ImageItem {
        path: path.to_string_lossy().to_string(),
        name,
    }
}

/// List image files inside `dir`, recursively, sorted by path.
pub fn list_images(dir: &str) -> Result<Vec<ImageItem>, String> {
    let root = Path::new(dir);
    if !root.is_dir() {
        return Err(format!(
            "Directory does not exist or is not a folder: {dir}"
        ));
    }

    let mut v = Vec::new();
    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_file() && is_image(path) {
            v.push(image_item(path));
        }
    }
    v.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(v)
}

/// Build `ImageItem`s for an explicit list of file paths (the "import images"
/// multi-select flow). Non-image and missing files are skipped.
pub fn image_items(paths: &[String]) -> Vec<ImageItem> {
    let mut v = Vec::new();
    for p in paths {
        let path = Path::new(p);
        if path.is_file() && is_image(path) {
            v.push(image_item(path));
        }
    }
    v
}

/// Probe image dimensions (reads only the header, fast).
pub fn image_size(path: &str) -> Result<(u32, u32), String> {
    image::image_dimensions(path).map_err(|e| format!("Failed to read image dimensions: {e}"))
}

fn annotation_path(image_path: &str) -> Result<std::path::PathBuf, String> {
    let p = Path::new(image_path);
    if !p.is_file() {
        return Err(format!("Image file does not exist: {image_path}"));
    }
    Ok(p.with_extension("json"))
}

pub fn read_annotation(image_path: &str) -> Result<Option<String>, String> {
    let p = annotation_path(image_path)?;
    if !p.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn save_annotation(image_path: &str, data: &str) -> Result<(), String> {
    let p = annotation_path(image_path)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}
