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

/// Resolve a unique annotation sidecar path for `image_path`.
///
/// The sidecar keeps the full filename so images that differ only by
/// extension (e.g. `a.jpg` vs `a.png`) don't share one annotation file:
/// `a.jpg` → `a.jpg.json`, `a.png` → `a.png.json`. (Previously we used
/// `with_extension("json")`, which collapsed both to `a.json` and silently
/// overwrote.)
fn annotation_path(image_path: &str) -> Result<std::path::PathBuf, String> {
    let p = Path::new(image_path);
    if !p.is_file() {
        return Err(format!("Image file does not exist: {image_path}"));
    }
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Invalid image path: {image_path}"))?;
    Ok(p.with_file_name(format!("{name}.json")))
}

/// The pre-collision layout (`a.jpg` → `a.json`), used only as a read
/// fallback so existing workspaces still load. Saves always go to the new
/// full-name sidecar, so loading migrates incrementally.
///
/// Only return a legacy path when it is UNAMBIGUOUS: if a sibling image in the
/// same directory shares the same stem with a different extension (e.g.
/// `a.jpg` and `a.png`), both would map to the same legacy `a.json` and we
/// can't tell which one it belonged to — so skip the fallback (return None,
/// treated as no annotation) rather than risk loading the wrong image's data.
fn legacy_annotation_path(image_path: &str) -> Option<std::path::PathBuf> {
    let p = Path::new(image_path);
    let stem = p.file_stem()?.to_str()?.to_string();
    let parent = p.parent()?;
    let my_ext = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    // Walk the parent dir once; if any other image shares this stem with a
    // different extension, the legacy file is ambiguous and must be ignored.
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let ep = entry.path();
            if ep == p {
                continue;
            }
            if !is_image(&ep) {
                continue;
            }
            let same_stem = ep
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s == stem)
                .unwrap_or(false);
            if !same_stem {
                continue;
            }
            let other_ext = ep
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            if other_ext != my_ext {
                return None; // ambiguous: a.jpg and a.png both → a.json
            }
        }
    }

    Some(p.with_file_name(format!("{stem}.json")))
}

pub fn read_annotation(image_path: &str) -> Result<Option<String>, String> {
    let p = annotation_path(image_path)?;
    if p.is_file() {
        return std::fs::read_to_string(&p)
            .map(Some)
            .map_err(|e| e.to_string());
    }
    // Migrate-on-read: an old-style `a.json` (without the extension) still
    // belongs to this image, so fall back to it — but only when unambiguous.
    // legacy_annotation_path returns None if a sibling image (e.g. `a.png`)
    // shares the same stem, since the legacy file can't be safely attributed.
    if let Some(legacy) = legacy_annotation_path(image_path) {
        if legacy.is_file() {
            return std::fs::read_to_string(&legacy)
                .map(Some)
                .map_err(|e| e.to_string());
        }
    }
    Ok(None)
}

pub fn save_annotation(image_path: &str, data: &str) -> Result<(), String> {
    let p = annotation_path(image_path)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "oarlabel-project-test-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sidecar_path_keeps_full_image_filename() {
        let dir = temp_workspace("sidecar");
        let image = dir.join("page.001.jpg");
        std::fs::write(&image, b"not a real image").unwrap();

        let sidecar = annotation_path(image.to_str().unwrap()).unwrap();

        assert_eq!(sidecar.file_name().unwrap(), "page.001.jpg.json");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_annotation_is_ignored_when_stem_is_ambiguous() {
        let dir = temp_workspace("legacy");
        let jpg = dir.join("page.jpg");
        let png = dir.join("page.png");
        std::fs::write(&jpg, b"jpg").unwrap();
        std::fs::write(&png, b"png").unwrap();
        std::fs::write(dir.join("page.json"), br#"{"version":1}"#).unwrap();

        let loaded = read_annotation(jpg.to_str().unwrap()).unwrap();

        assert!(loaded.is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn save_annotation_writes_atomically_to_full_name_sidecar() {
        let dir = temp_workspace("save");
        let image = dir.join("scan.png");
        std::fs::write(&image, b"png").unwrap();

        save_annotation(image.to_str().unwrap(), r#"{"version":1}"#).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join("scan.png.json")).unwrap(),
            r#"{"version":1}"#
        );
        assert!(!dir.join("scan.png.json.tmp").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
