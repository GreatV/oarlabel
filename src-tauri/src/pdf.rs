//! PDF import: rasterize each page of a PDF to a PNG on disk so the rest of the
//! app can treat it like a folder of images.
//!
//! Rendering uses the pure-Rust `hayro` library (no external binaries), mirroring
//! `examples/utils/pdf.rs` in the oar-ocr repository.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hayro::hayro_syntax::Pdf;

use crate::project::ImageItem;

const PDF_IMPORT_CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

fn render_pages(pdf_path: &str) -> Result<Vec<image::RgbImage>, String> {
    use hayro::RenderSettings;

    let data = std::fs::read(pdf_path).map_err(|e| format!("Failed to read PDF: {e}"))?;
    let pdf = Pdf::new(Arc::new(data)).map_err(|e| format!("Failed to parse PDF: {e:?}"))?;
    let pages = pdf.pages();

    let interpreter_settings = hayro::hayro_interpret::InterpreterSettings::default();
    let mut out = Vec::with_capacity(pages.len());

    for page in pages.iter() {
        let media_box = page.media_box();
        let width = (media_box.x1 - media_box.x0) as f32;
        let height = (media_box.y1 - media_box.y0) as f32;
        if width <= 0.0 || height <= 0.0 {
            return Err(format!("Invalid page size: {width}x{height}"));
        }

        // Fixed 2x render scale. (There used to be a max_size parameter for
        // downscaling large pages, but it was always passed None, so it has been
        // removed to avoid carrying dead configuration.)
        let scale = 2.0;

        let settings = RenderSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: hayro::vello_cpu::color::palette::css::WHITE,
            ..Default::default()
        };

        let pixmap = hayro::render(page, &interpreter_settings, &settings);
        let rgba = pixmap.data_as_u8_slice();
        let mut rgb = Vec::with_capacity(pixmap.width() as usize * pixmap.height() as usize * 3);
        for chunk in rgba.chunks(4) {
            rgb.push(chunk[0]);
            rgb.push(chunk[1]);
            rgb.push(chunk[2]);
        }
        let img =
            image::RgbImage::from_raw(u32::from(pixmap.width()), u32::from(pixmap.height()), rgb)
                .ok_or("Failed to convert rendered page into an image")?;
        out.push(img);
    }

    Ok(out)
}

fn cleanup_old_imports(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }

    let now = SystemTime::now();
    for entry in
        std::fs::read_dir(root).map_err(|e| format!("Failed to read PDF cache directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read PDF cache entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let meta = entry
            .metadata()
            .map_err(|e| format!("Failed to read PDF cache metadata: {e}"))?;
        let modified = meta
            .modified()
            .map_err(|e| format!("Failed to read PDF cache modification time: {e}"))?;
        if now.duration_since(modified).unwrap_or(Duration::ZERO) > PDF_IMPORT_CACHE_MAX_AGE {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to clean PDF cache: {e}"))?;
        }
    }
    Ok(())
}

/// Render every page of `pdf_path` to PNG files. When `out_dir` is not provided,
/// pages are written into the app cache under `default_root`.
pub fn import_pdf(
    pdf_path: &str,
    default_root: &Path,
    out_dir: Option<&str>,
) -> Result<Vec<ImageItem>, String> {
    let src = Path::new(pdf_path);
    if !src.is_file() {
        return Err(format!("PDF file does not exist: {pdf_path}"));
    }

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf")
        .to_string();
    let dir: PathBuf = match out_dir {
        Some(d) => PathBuf::from(d),
        None => {
            cleanup_old_imports(default_root)?;
            let created_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| format!("Failed to get import timestamp: {e}"))?
                .as_millis();
            default_root.join(format!("{stem}_{created_at}_pages"))
        }
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create output directory: {e}"))?;

    let pages = render_pages(pdf_path)?;
    if pages.is_empty() {
        return Err("PDF has no renderable pages".into());
    }

    let mut items = Vec::with_capacity(pages.len());
    for (i, img) in pages.iter().enumerate() {
        let name = format!("{stem}_page-{:04}.png", i + 1);
        let path = dir.join(&name);
        img.save(&path)
            .map_err(|e| format!("Failed to save page {}: {e}", i + 1))?;
        items.push(ImageItem {
            path: path.to_string_lossy().to_string(),
            name,
        });
    }
    Ok(items)
}
