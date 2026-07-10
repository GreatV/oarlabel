//! Export to PaddleOCR training formats.
//!
//! - Detection: PPOCRLabel-style `Label.txt` with one line per image:
//!   `parent/filename\t[{"transcription","points","difficult"}, ...]`
//! - Recognition: `rec_gt.txt` (`crop_img/xxx.jpg\ttext`) plus a `crop_img/`
//!   folder of perspective-cropped text line images.

use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

use crate::geometry;

#[derive(Deserialize)]
pub struct ExportBox {
    pub points: Vec<[f32; 2]>,
    pub transcription: String,
}

#[derive(Deserialize)]
pub struct ExportImage {
    /// Absolute source image path.
    pub path: String,
    pub boxes: Vec<ExportBox>,
}

/// Write `Label.txt` (detection annotations) into `out_dir`.
pub fn export_detection(images: &[ExportImage], out_dir: &str) -> Result<String, String> {
    let out = Path::new(out_dir);
    let images_dir = out.join("images");
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let mut label = String::new();
    let mut used_names = HashSet::new();
    for img in images {
        let p = Path::new(&img.path);
        let fname = unique_export_name(p, &mut used_names);
        std::fs::copy(p, images_dir.join(&fname))
            .map_err(|e| format!("Failed to copy image {}: {e}", img.path))?;
        let rel = format!("images/{}", fname);

        let arr: Vec<serde_json::Value> = img
            .boxes
            .iter()
            .map(|b| {
                let pts: Vec<Vec<i64>> = b
                    .points
                    .iter()
                    .map(|pt| vec![pt[0].round() as i64, pt[1].round() as i64])
                    .collect();
                serde_json::json!({
                    "transcription": b.transcription,
                    "points": pts,
                    "difficult": false
                })
            })
            .collect();

        let json = serde_json::to_string(&arr).map_err(|e| e.to_string())?;
        label.push_str(&format!("{}\t{}\n", rel, json));
    }

    let label_path = out.join("Label.txt");
    std::fs::write(&label_path, label).map_err(|e| e.to_string())?;
    Ok(label_path.to_string_lossy().to_string())
}

/// Write `rec_gt.txt` and crop images into `out_dir/crop_img/`.
pub fn export_recognition(images: &[ExportImage], out_dir: &str) -> Result<String, String> {
    let out = Path::new(out_dir);
    let crop_dir = out.join("crop_img");
    std::fs::create_dir_all(&crop_dir).map_err(|e| e.to_string())?;

    let mut gt = String::new();
    let mut counter: usize = 0;
    for img in images {
        if img.boxes.iter().all(|b| b.transcription.trim().is_empty()) {
            continue;
        }
        let src = image::open(&img.path)
            .map_err(|e| format!("Failed to open image {}: {e}", img.path))?
            .to_rgb8();

        for b in &img.boxes {
            let text = b.transcription.trim();
            if text.is_empty() {
                continue;
            }
            let crop = geometry::crop_quad(&src, &b.points)
                .map_err(|e| format!("Failed to crop image {}: {e}", img.path))?;
            let name = format!("img_{:06}.jpg", counter);
            counter += 1;
            crop.save(crop_dir.join(&name))
                .map_err(|e| format!("Failed to save crop image: {e}"))?;
            gt.push_str(&format!("crop_img/{}\t{}\n", name, sanitize_rec_text(text)));
        }
    }

    let gt_path = out.join("rec_gt.txt");
    std::fs::write(&gt_path, gt).map_err(|e| e.to_string())?;
    Ok(gt_path.to_string_lossy().to_string())
}

/// Normalize a recognition transcription for the TSV `rec_gt.txt` format.
/// Each record must be one tab-separated line, so any control character that
/// would break line/field splitting (\r, \n, \t, and other C0 controls) is
/// collapsed to a single space.
fn sanitize_rec_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.chars() {
        if c == '\t' || c == '\r' || c == '\n' || (c.is_control()) {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(c);
            prev_space = c == ' ';
        }
    }
    out.trim().to_string()
}

fn unique_export_name(path: &Path, used: &mut HashSet<String>) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("image");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("png");
    let mut idx = 0usize;
    loop {
        let name = if idx == 0 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}_{idx}.{ext}")
        };
        // Most macOS and Windows volumes are case-insensitive. Reserve a
        // normalized key so `scan.JPG` and `scan.jpg` cannot overwrite each
        // other even though their source spellings differ.
        if used.insert(name.to_lowercase()) {
            return name;
        }
        idx += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rec_text_collapses_record_separators() {
        assert_eq!(
            sanitize_rec_text("  hello\tworld\nnext\r\u{0007}field  "),
            "hello world next field"
        );
    }

    #[test]
    fn unique_export_name_adds_suffix_for_collisions() {
        let mut used = HashSet::new();

        assert_eq!(
            unique_export_name(Path::new("scan.jpg"), &mut used),
            "scan.jpg"
        );
        assert_eq!(
            unique_export_name(Path::new("other/scan.jpg"), &mut used),
            "scan_1.jpg"
        );
        assert_eq!(
            unique_export_name(Path::new("other/SCAN.JPG"), &mut used),
            "SCAN_2.JPG"
        );
    }
}
