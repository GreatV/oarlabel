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

/// Render every page of `pdf_path` to PNG files in the app cache under
/// `default_root`. Callers cannot choose an arbitrary output path.
pub fn import_pdf(pdf_path: &str, default_root: &Path) -> Result<Vec<ImageItem>, String> {
    let src = Path::new(pdf_path);
    if !src.is_file() {
        return Err(format!("PDF file does not exist: {pdf_path}"));
    }

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf")
        .to_string();
    cleanup_old_imports(default_root)?;
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get import timestamp: {e}"))?
        .as_millis();
    let dir: PathBuf = default_root.join(format!("{stem}_{created_at}_pages"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create output directory: {e}"))?;

    let data = std::fs::read(pdf_path).map_err(|e| format!("Failed to read PDF: {e}"))?;
    let pdf = Pdf::new(Arc::new(data)).map_err(|e| format!("Failed to parse PDF: {e:?}"))?;
    let pages = pdf.pages();
    if pages.is_empty() {
        return Err("PDF has no renderable pages".into());
    }

    use hayro::RenderSettings;
    let interpreter_settings = hayro::hayro_interpret::InterpreterSettings::default();
    let mut items = Vec::with_capacity(pages.len());
    for (i, page) in pages.iter().enumerate() {
        let media_box = page.media_box();
        let width = (media_box.x1 - media_box.x0) as f32;
        let height = (media_box.y1 - media_box.y0) as f32;
        if width <= 0.0 || height <= 0.0 {
            return Err(format!("Invalid page size: {width}x{height}"));
        }

        // Render and persist one page at a time. Keeping every 2x raster in a
        // Vec made long PDFs consume memory proportional to their page count.
        let settings = RenderSettings {
            x_scale: 2.0,
            y_scale: 2.0,
            bg_color: hayro::vello_cpu::color::palette::css::WHITE,
            ..Default::default()
        };
        let pixmap = hayro::render(page, &interpreter_settings, &settings);
        let rgba = pixmap.data_as_u8_slice();
        let mut rgb = Vec::with_capacity(pixmap.width() as usize * pixmap.height() as usize * 3);
        for chunk in rgba.chunks_exact(4) {
            rgb.extend_from_slice(&chunk[..3]);
        }
        let img =
            image::RgbImage::from_raw(u32::from(pixmap.width()), u32::from(pixmap.height()), rgb)
                .ok_or("Failed to convert rendered page into an image")?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn minimal_pdf() -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 10] /Resources << >> /Contents 4 0 R >>",
            "<< /Length 0 >>\nstream\n\nendstream",
        ];
        let mut bytes = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::with_capacity(objects.len());
        for (index, object) in objects.iter().enumerate() {
            offsets.push(bytes.len());
            write!(&mut bytes, "{} 0 obj\n{}\nendobj\n", index + 1, object).unwrap();
        }
        let xref = bytes.len();
        write!(&mut bytes, "xref\n0 {}\n", objects.len() + 1).unwrap();
        bytes.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets {
            writeln!(&mut bytes, "{offset:010} 00000 n ").unwrap();
        }
        write!(
            &mut bytes,
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1,
        )
        .unwrap();
        bytes
    }

    #[test]
    fn import_pdf_renders_a_page_to_disk() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("oarlabel-pdf-test-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("sample.pdf");
        std::fs::write(&source, minimal_pdf()).unwrap();

        let items = import_pdf(source.to_str().unwrap(), &root.join("cache")).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "sample_page-0001.png");
        assert_eq!(image::image_dimensions(&items[0].path).unwrap(), (40, 20));
        let _ = std::fs::remove_dir_all(root);
    }
}
