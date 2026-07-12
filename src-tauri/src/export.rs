//! Export to PaddleOCR training formats.
//!
//! - Detection: PaddleOCR `train.txt` / `val.txt` with one line per image:
//!   `parent/filename\t[{"transcription","points","difficult"}, ...]`
//! - Recognition and formula recognition: `train_list.txt` / `val_list.txt`
//!   plus `train/` and `val/` folders of perspective-cropped images.
//! - Layout detection: COCO `annotations/train.json` / `annotations/val.json`
//!   plus copied images.

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

/// Write `train.txt` and `val.txt` detection annotations into `out_dir`.
pub fn export_detection(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
    let out = Path::new(out_dir);
    let images_dir = out.join("images");
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let mut train_label = String::new();
    let mut val_label = String::new();
    let mut used_names = HashSet::new();
    for (index, img) in images.iter().enumerate() {
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
        let line = format!("{}\t{}\n", rel, json);
        push_split_line(index, images.len(), &line, &mut train_label, &mut val_label);
    }

    let label_path = out.join("train.txt");
    std::fs::write(&label_path, train_label).map_err(|e| e.to_string())?;
    std::fs::write(out.join("val.txt"), val_label).map_err(|e| e.to_string())?;
    Ok(ExportResult {
        path: label_path.to_string_lossy().into_owned(),
        skipped: 0,
    })
}

/// Write PaddleOCR recognition labels and crop images into train/val splits.
pub fn export_recognition(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
    export_cropped_lists(images, out_dir, "img", "jpg")
}

/// Write formula recognition labels and crop images into train/val splits.
pub fn export_formula(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
    export_cropped_lists(images, out_dir, "formula", "png")
}

fn export_cropped_lists(
    images: &[ExportImage],
    out_dir: &str,
    prefix: &str,
    ext: &str,
) -> Result<ExportResult, String> {
    let out = Path::new(out_dir);
    let train_dir = out.join("train");
    let val_dir = out.join("val");
    std::fs::create_dir_all(&train_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&val_dir).map_err(|e| e.to_string())?;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let staging_dir = out.join(format!(".oarlabel-crops-{}-{nonce}", std::process::id()));
    std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    // Crop pixels are written to a temporary staging directory immediately.
    // Keep only lightweight names/text in memory while determining the exact
    // train/validation split, then copy each staged file to its destination.
    let result = (|| -> Result<ExportResult, String> {
        let mut crops = Vec::<(String, String)>::new();
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
                let name = format!("{prefix}_{:06}.{ext}", crops.len());
                crop.save(staging_dir.join(&name))
                    .map_err(|e| format!("Failed to stage crop image: {e}"))?;
                crops.push((name, sanitize_rec_text(text)));
            }
        }

        let total = crops.len();
        let mut train_list = String::new();
        let mut val_list = String::new();
        for (index, (name, text)) in crops.into_iter().enumerate() {
            let source = staging_dir.join(&name);
            if total == 1 || !is_val_index(index, total) {
                std::fs::copy(&source, train_dir.join(&name))
                    .map_err(|e| format!("Failed to save training crop: {e}"))?;
                train_list.push_str(&format!("train/{name}\t{text}\n"));
            }
            if total == 1 || is_val_index(index, total) {
                std::fs::copy(&source, val_dir.join(&name))
                    .map_err(|e| format!("Failed to save validation crop: {e}"))?;
                val_list.push_str(&format!("val/{name}\t{text}\n"));
            }
        }

        let train_path = out.join("train_list.txt");
        std::fs::write(&train_path, train_list).map_err(|e| e.to_string())?;
        std::fs::write(out.join("val_list.txt"), val_list).map_err(|e| e.to_string())?;
        Ok(ExportResult {
            path: train_path.to_string_lossy().into_owned(),
            skipped,
        })
    })();
    std::fs::remove_dir_all(staging_dir).ok();
    result
}

/// Export layout annotations as a COCO detection dataset.
pub fn export_layout(images: &[ExportImage], out_dir: &str) -> Result<ExportResult, String> {
    let out = Path::new(out_dir);
    let images_dir = out.join("images");
    let annotations_dir = out.join("annotations");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&annotations_dir).map_err(|e| e.to_string())?;

    let mut used_names = HashSet::new();
    let mut category_ids = HashMap::<String, u64>::new();
    let mut train_images = Vec::new();
    let mut train_annotations = Vec::new();
    let mut val_images = Vec::new();
    let mut val_annotations = Vec::new();
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
        let coco_image = serde_json::json!({
            "id": image_id,
            "file_name": filename,
            "width": width,
            "height": height
        });
        let mut image_annotations = Vec::new();

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
            image_annotations.push(serde_json::json!({
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

        if images.len() == 1 || !is_val_index(image_index, images.len()) {
            train_images.push(coco_image.clone());
            train_annotations.extend(image_annotations.iter().cloned());
        }
        if images.len() == 1 || is_val_index(image_index, images.len()) {
            val_images.push(coco_image);
            val_annotations.extend(image_annotations);
        }
    }

    let mut categories = category_ids
        .into_iter()
        .map(|(name, id)| serde_json::json!({ "id": id, "name": name }))
        .collect::<Vec<_>>();
    categories.sort_by_key(|category| category["id"].as_u64().unwrap_or_default());
    let train_path = annotations_dir.join("train.json");
    write_coco(
        &train_path,
        train_images,
        train_annotations,
        categories.clone(),
    )?;
    write_coco(
        &annotations_dir.join("val.json"),
        val_images,
        val_annotations,
        categories,
    )?;
    Ok(ExportResult {
        path: train_path.to_string_lossy().into_owned(),
        skipped,
    })
}

fn write_coco(
    path: &Path,
    images: Vec<serde_json::Value>,
    annotations: Vec<serde_json::Value>,
    categories: Vec<serde_json::Value>,
) -> Result<(), String> {
    let output = serde_json::json!({
        "images": images,
        "annotations": annotations,
        "categories": categories
    });
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&output).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Normalize a recognition transcription for the TSV list format.
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

fn is_val_index(index: usize, total: usize) -> bool {
    if total <= 1 {
        return true;
    }
    let val_count = (total / 10).max(1);
    index >= total - val_count
}

fn push_split_line(index: usize, total: usize, line: &str, train: &mut String, val: &mut String) {
    if total == 1 || !is_val_index(index, total) {
        train.push_str(line);
    }
    if total == 1 || is_val_index(index, total) {
        val.push_str(line);
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
    fn detection_export_writes_paddleocr_train_file() {
        let dir = temp_dir("detection");
        let source = dir.join("source.png");
        RgbImage::from_pixel(8, 8, Rgb([255, 255, 255]))
            .save(&source)
            .unwrap();
        let output = dir.join("output");
        let result = export_detection(
            &[ExportImage {
                path: source.to_string_lossy().into_owned(),
                boxes: vec![ExportBox {
                    points: vec![[1.0, 1.0], [6.0, 1.0], [6.0, 5.0], [1.0, 5.0]],
                    transcription: "text".into(),
                    label: None,
                }],
            }],
            &output.to_string_lossy(),
        )
        .expect("detection export");

        let label_path = Path::new(&result.path);
        assert_eq!(label_path.file_name().unwrap(), "train.txt");
        assert!(output.join("images").join("source.png").exists());
        assert!(std::fs::read_to_string(label_path)
            .unwrap()
            .starts_with("images/source.png\t"));
        assert!(std::fs::read_to_string(output.join("val.txt"))
            .unwrap()
            .starts_with("images/source.png\t"));
        std::fs::remove_dir_all(dir).ok();
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
        assert_eq!(
            Path::new(&result.path).file_name().unwrap(),
            "train_list.txt"
        );
        assert_eq!(std::fs::read_to_string(result.path).unwrap(), "");
        assert_eq!(
            std::fs::read_to_string(output.join("val_list.txt")).unwrap(),
            ""
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn recognition_export_writes_paddleocr_train_and_val_lists() {
        let dir = temp_dir("recognition");
        let source = dir.join("source.png");
        RgbImage::from_pixel(16, 16, Rgb([255, 255, 255]))
            .save(&source)
            .unwrap();
        let output = dir.join("output");
        let result = export_recognition(
            &[ExportImage {
                path: source.to_string_lossy().into_owned(),
                boxes: vec![ExportBox {
                    points: vec![[1.0, 1.0], [14.0, 1.0], [14.0, 10.0], [1.0, 10.0]],
                    transcription: "hello".into(),
                    label: None,
                }],
            }],
            &output.to_string_lossy(),
        )
        .expect("recognition export");

        let gt = std::fs::read_to_string(&result.path).unwrap();
        assert_eq!(
            Path::new(&result.path).file_name().unwrap(),
            "train_list.txt"
        );
        assert_eq!(gt, "train/img_000000.jpg\thello\n");
        assert_eq!(
            std::fs::read_to_string(output.join("val_list.txt")).unwrap(),
            "val/img_000000.jpg\thello\n"
        );
        assert!(output.join("train").join("img_000000.jpg").exists());
        assert!(output.join("val").join("img_000000.jpg").exists());
        assert!(std::fs::read_dir(&output)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".oarlabel-crops-")));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn formula_export_uses_recognition_list_format() {
        let dir = temp_dir("formula");
        let source = dir.join("source.png");
        RgbImage::from_pixel(24, 16, Rgb([255, 255, 255]))
            .save(&source)
            .unwrap();
        let output = dir.join("output");
        let result = export_formula(
            &[ExportImage {
                path: source.to_string_lossy().into_owned(),
                boxes: vec![ExportBox {
                    points: vec![[1.0, 1.0], [22.0, 1.0], [22.0, 12.0], [1.0, 12.0]],
                    transcription: r"\frac{1}{2}".into(),
                    label: Some("formula".into()),
                }],
            }],
            &output.to_string_lossy(),
        )
        .expect("formula export");

        let gt = std::fs::read_to_string(&result.path).unwrap();
        assert_eq!(
            Path::new(&result.path).file_name().unwrap(),
            "train_list.txt"
        );
        assert_eq!(gt, "train/formula_000000.png\t\\frac{1}{2}\n");
        assert_eq!(
            std::fs::read_to_string(output.join("val_list.txt")).unwrap(),
            "val/formula_000000.png\t\\frac{1}{2}\n"
        );
        assert!(output.join("train").join("formula_000000.png").exists());
        assert!(output.join("val").join("formula_000000.png").exists());
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

        let coco_path = Path::new(&result.path);
        assert_eq!(coco_path.file_name().unwrap(), "train.json");
        assert_eq!(
            coco_path.parent().unwrap().file_name().unwrap(),
            "annotations"
        );
        let coco: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(coco_path).unwrap()).unwrap();
        assert_eq!(coco["annotations"].as_array().unwrap().len(), 1);
        assert_eq!(coco["images"][0]["file_name"], "source.png");
        assert_eq!(coco["categories"][0]["name"], "title");
        let val_coco: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(output.join("annotations").join("val.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(val_coco["annotations"].as_array().unwrap().len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }
}
