//! Export to PaddleOCR training formats.
//!
//! - Detection: PPOCRLabel-style `Label.txt` with one line per image:
//!   `parent/filename\t[{"transcription","points","difficult"}, ...]`
//! - Recognition: `rec_gt.txt` (`crop_img/xxx.jpg\ttext`) plus a `crop_img/`
//!   folder of perspective-cropped text line images.

use image::{Rgb, RgbImage};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

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
            .map_err(|e| format!("复制图像失败 {}: {e}", img.path))?;
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
            .map_err(|e| format!("打开图像失败 {}: {e}", img.path))?
            .to_rgb8();

        for b in &img.boxes {
            let text = b.transcription.trim();
            if text.is_empty() {
                continue;
            }
            let crop = crop_quad(&src, &b.points);
            let name = format!("img_{:06}.jpg", counter);
            counter += 1;
            crop.save(crop_dir.join(&name))
                .map_err(|e| format!("保存裁剪图失败: {e}"))?;
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

// ---- geometry helpers -----------------------------------------------------

fn dist(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
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
        if used.insert(name.clone()) {
            return name;
        }
        idx += 1;
    }
}

fn lerp(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// Order an arbitrary set of polygon points into TL, TR, BR, BL. For non-quad
/// polygons we fall back to the axis-aligned bounding rectangle.
fn order_quad(points: &[[f32; 2]]) -> [[f32; 2]; 4] {
    if points.len() == 4 {
        // Classic sum/diff ordering: TL has min(x+y), BR max(x+y);
        // TR has min(y-x), BL max(y-x).
        let mut tl = points[0];
        let mut br = points[0];
        let mut tr = points[0];
        let mut bl = points[0];
        let (mut min_sum, mut max_sum) = (f32::INFINITY, f32::NEG_INFINITY);
        let (mut min_diff, mut max_diff) = (f32::INFINITY, f32::NEG_INFINITY);
        for &p in points {
            let sum = p[0] + p[1];
            let diff = p[1] - p[0];
            if sum < min_sum {
                min_sum = sum;
                tl = p;
            }
            if sum > max_sum {
                max_sum = sum;
                br = p;
            }
            if diff < min_diff {
                min_diff = diff;
                tr = p;
            }
            if diff > max_diff {
                max_diff = diff;
                bl = p;
            }
        }
        [tl, tr, br, bl]
    } else {
        let xs = points.iter().map(|p| p[0]);
        let ys = points.iter().map(|p| p[1]);
        let x0 = xs.clone().fold(f32::INFINITY, f32::min);
        let x1 = xs.fold(f32::NEG_INFINITY, f32::max);
        let y0 = ys.clone().fold(f32::INFINITY, f32::min);
        let y1 = ys.fold(f32::NEG_INFINITY, f32::max);
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }
}

fn sample_bilinear(src: &RgbImage, x: f32, y: f32) -> Rgb<u8> {
    let (w, h) = (src.width() as i32, src.height() as i32);
    if w == 0 || h == 0 {
        return Rgb([255, 255, 255]);
    }
    let x = x.clamp(0.0, (w - 1) as f32);
    let y = y.clamp(0.0, (h - 1) as f32);
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;

    let p = |px: i32, py: i32| src.get_pixel(px as u32, py as u32).0;
    let p00 = p(x0, y0);
    let p10 = p(x1, y0);
    let p01 = p(x0, y1);
    let p11 = p(x1, y1);

    let mut out = [0u8; 3];
    for c in 0..3 {
        let top = p00[c] as f32 * (1.0 - fx) + p10[c] as f32 * fx;
        let bot = p01[c] as f32 * (1.0 - fx) + p11[c] as f32 * fx;
        out[c] = (top * (1.0 - fy) + bot * fy).round().clamp(0.0, 255.0) as u8;
    }
    Rgb(out)
}

/// PaddleOCR-style rotate-crop: map a (possibly rotated) quadrilateral to an
/// axis-aligned crop using bilinear sampling along the quad's edges.
fn crop_quad(src: &RgbImage, points: &[[f32; 2]]) -> RgbImage {
    let [tl, tr, br, bl] = order_quad(points);

    let w = dist(tr, tl).max(dist(br, bl)).round().max(1.0) as u32;
    let h = dist(bl, tl).max(dist(br, tr)).round().max(1.0) as u32;

    let mut dst = RgbImage::new(w, h);
    for y in 0..h {
        let v = (y as f32 + 0.5) / h as f32;
        for x in 0..w {
            let u = (x as f32 + 0.5) / w as f32;
            let top = lerp(tl, tr, u);
            let bot = lerp(bl, br, u);
            let s = lerp(top, bot, v);
            dst.put_pixel(x, y, sample_bilinear(src, s[0], s[1]));
        }
    }
    dst
}
