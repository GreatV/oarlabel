//! Export to PaddleOCR training formats.
//!
//! - Detection: PPOCRLabel-style `Label.txt` with one line per image:
//!   `parent/filename\t[{"transcription","points","difficult"}, ...]`
//! - Recognition: `rec_gt.txt` (`crop_img/xxx.jpg\ttext`) plus a `crop_img/`
//!   folder of perspective-cropped text line images.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::geometry;

#[derive(Deserialize)]
pub struct ExportBox {
    pub points: Vec<[f32; 2]>,
    pub transcription: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub path: String,
    pub skipped: u32,
}

#[derive(Deserialize)]
pub struct ExportImage {
    /// Absolute source image path.
    pub path: String,
    pub boxes: Vec<ExportBox>,
}

/// Write `Label.txt` (detection annotations) into `out_dir`.
pub fn export_detection(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
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
    Ok(ExportResult {
        path: label_path.to_string_lossy().into_owned(),
        skipped: 0,
    })
}

/// Write `rec_gt.txt` and crop images into `out_dir/crop_img/`.
pub fn export_recognition(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
    let out = Path::new(out_dir);
    let crop_dir = out.join("crop_img");
    std::fs::create_dir_all(&crop_dir).map_err(|e| e.to_string())?;

    let mut gt = String::new();
    let mut counter: usize = 0;
    let mut skipped = 0u32;
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
            let crop = match geometry::crop_quad(&src, &b.points) {
                Ok(crop) => crop,
                Err(error) => {
                    skipped += 1;
                    tracing::warn!(image = %img.path, %error, "skipping invalid export crop");
                    continue;
                }
            };
            let name = format!("img_{:06}.jpg", counter);
            counter += 1;
            crop.save(crop_dir.join(&name))
                .map_err(|e| format!("Failed to save crop image: {e}"))?;
            gt.push_str(&format!("crop_img/{}\t{}\n", name, sanitize_rec_text(text)));
        }
    }

    let gt_path = out.join("rec_gt.txt");
    std::fs::write(&gt_path, gt).map_err(|e| e.to_string())?;
    Ok(ExportResult {
        path: gt_path.to_string_lossy().into_owned(),
        skipped,
    })
}

/// Export layout annotations as a COCO detection dataset.
pub fn export_layout(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
    let out = Path::new(out_dir);
    let images_dir = out.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let mut used_names = HashSet::new();
    let mut category_ids = HashMap::<String, u64>::new();
    let mut coco_images = Vec::new();
    let mut coco_annotations = Vec::new();
    let mut annotation_id = 1u64;
    let mut skipped = 0u32;

    for (image_index, image) in images.iter().enumerate() {
        let source = Path::new(&image.path);
        let filename = unique_export_name(source, &mut used_names);
        let destination = images_dir.join(&filename);
        std::fs::copy(source, &destination)
            .map_err(|e| format!("Failed to copy image {}: {e}", image.path))?;
        let (width, height) = image::image_dimensions(source)
            .map_err(|e| format!("Failed to read image dimensions {}: {e}", image.path))?;
        let image_id = image_index as u64 + 1;
        coco_images.push(serde_json::json!({
            "id": image_id,
            "file_name": format!("images/{filename}"),
            "width": width,
            "height": height
        }));

        for b in &image.boxes {
            if b.points.len() < 3 || !b.points.iter().flatten().all(|value| value.is_finite()) {
                skipped += 1;
                continue;
            }
            let label = b
                .label
                .as_deref()
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .unwrap_or("region")
                .to_string();
            let next_category_id = category_ids.len() as u64 + 1;
            let category_id = *category_ids.entry(label).or_insert(next_category_id);
            let x_min = b.points.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min);
            let y_min = b.points.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
            let x_max = b
                .points
                .iter()
                .map(|p| p[0])
                .fold(f32::NEG_INFINITY, f32::max);
            let y_max = b
                .points
                .iter()
                .map(|p| p[1])
                .fold(f32::NEG_INFINITY, f32::max);
            let box_width = x_max - x_min;
            let box_height = y_max - y_min;
            if box_width <= 0.0 || box_height <= 0.0 {
                skipped += 1;
                continue;
            }
            let segmentation = b
                .points
                .iter()
                .flat_map(|point| [point[0], point[1]])
                .collect::<Vec<_>>();
            coco_annotations.push(serde_json::json!({
                "id": annotation_id,
                "image_id": image_id,
                "category_id": category_id,
                "segmentation": [segmentation],
                "bbox": [x_min, y_min, box_width, box_height],
                "area": box_width * box_height,
                "iscrowd": 0
            }));
            annotation_id += 1;
        }
    }

    let mut categories = category_ids
        .into_iter()
        .map(|(name, id)| serde_json::json!({ "id": id, "name": name }))
        .collect::<Vec<_>>();
    categories.sort_by_key(|category| category["id"].as_u64().unwrap_or_default());
    let output = serde_json::json!({
        "images": coco_images,
        "annotations": coco_annotations,
        "categories": categories
    });
    let path = out.join("layout_coco.json");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&output).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        skipped,
    })
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
    use image::{Rgb, RgbImage};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("oarlabel-export-{name}-{nonce}"));
        std::fs::create_dir_all(&dir).expect("create temp directory");
        dir
    }

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

    #[test]
    fn recognition_export_skips_invalid_crops() {
        let dir = temp_dir("invalid-crop");
        let source = dir.join("source.png");
        RgbImage::from_pixel(8, 8, Rgb([255, 255, 255]))
            .save(&source)
            .unwrap();
        let output = dir.join("output");
        let result = export_recognition(
            &[ExportImage {
                path: source.to_string_lossy().into_owned(),
                boxes: vec![ExportBox {
                    points: vec![[1.0, 1.0], [2.0, 1.0], [3.0, 1.0]],
                    transcription: "text".into(),
                    label: None,
                }],
            }],
            &output.to_string_lossy(),
        )
        .expect("export should continue");

        assert_eq!(result.skipped, 1);
        assert_eq!(std::fs::read_to_string(result.path).unwrap(), "");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn layout_export_writes_coco_categories() {
        let dir = temp_dir("layout");
        let source = dir.join("source.png");
        RgbImage::from_pixel(8, 8, Rgb([255, 255, 255]))
            .save(&source)
            .unwrap();
        let output = dir.join("output");
        let result = export_layout(
            &[ExportImage {
                path: source.to_string_lossy().into_owned(),
                boxes: vec![ExportBox {
                    points: vec![[1.0, 1.0], [6.0, 1.0], [6.0, 5.0], [1.0, 5.0]],
                    transcription: String::new(),
                    label: Some("title".into()),
                }],
            }],
            &output.to_string_lossy(),
        )
        .expect("layout export");

        let coco: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(result.path).unwrap()).unwrap();
        assert_eq!(coco["annotations"].as_array().unwrap().len(), 1);
        assert_eq!(coco["categories"][0]["name"], "title");
        std::fs::remove_dir_all(dir).ok();
    }
}
