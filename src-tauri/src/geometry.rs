//! Shared annotation geometry and image-cropping helpers.

use image::RgbImage;
use oar_ocr::processors::Point;
use oar_ocr::utils::get_rotate_crop_image;

const INVALID_REGION: &str = "Invalid recognition region coordinates";

pub(crate) fn distance(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn bounds(points: &[[f32; 2]]) -> Result<(f32, f32, f32, f32), String> {
    if points.is_empty() || !points.iter().flatten().all(|value| value.is_finite()) {
        return Err(INVALID_REGION.into());
    }
    let x_min = points
        .iter()
        .map(|point| point[0])
        .fold(f32::INFINITY, f32::min);
    let x_max = points
        .iter()
        .map(|point| point[0])
        .fold(f32::NEG_INFINITY, f32::max);
    let y_min = points
        .iter()
        .map(|point| point[1])
        .fold(f32::INFINITY, f32::min);
    let y_max = points
        .iter()
        .map(|point| point[1])
        .fold(f32::NEG_INFINITY, f32::max);
    Ok((x_min, y_min, x_max, y_max))
}

/// Normalize a polygon to top-left, top-right, bottom-right, bottom-left.
/// Non-quadrilateral polygons use their axis-aligned bounding rectangle.
pub(crate) fn order_quad(points: &[[f32; 2]]) -> Result<[[f32; 2]; 4], String> {
    let (x_min, y_min, x_max, y_max) = bounds(points)?;

    if points.len() == 4 {
        let mut tl = points[0];
        let mut br = points[0];
        let mut tr = points[0];
        let mut bl = points[0];
        let (mut min_sum, mut max_sum) = (f32::INFINITY, f32::NEG_INFINITY);
        let (mut min_diff, mut max_diff) = (f32::INFINITY, f32::NEG_INFINITY);
        for &point in points {
            let sum = point[0] + point[1];
            let diff = point[1] - point[0];
            if sum < min_sum {
                min_sum = sum;
                tl = point;
            }
            if sum > max_sum {
                max_sum = sum;
                br = point;
            }
            if diff < min_diff {
                min_diff = diff;
                tr = point;
            }
            if diff > max_diff {
                max_diff = diff;
                bl = point;
            }
        }
        Ok([tl, tr, br, bl])
    } else {
        Ok([
            [x_min, y_min],
            [x_max, y_min],
            [x_max, y_max],
            [x_min, y_max],
        ])
    }
}

pub(crate) fn is_vertical_quad(points: &[[f32; 2]]) -> bool {
    let Ok([tl, tr, br, bl]) = order_quad(points) else {
        return false;
    };
    let width = distance(tl, tr).max(distance(bl, br));
    let height = distance(tl, bl).max(distance(tr, br));
    height >= width * 1.2
}

/// Perspective-crop and rectify an arbitrary annotation polygon.
pub(crate) fn crop_quad(src: &RgbImage, points: &[[f32; 2]]) -> Result<RgbImage, String> {
    let ordered = order_quad(points)?;
    let box_points = ordered
        .into_iter()
        .map(|point| Point::new(point[0], point[1]))
        .collect::<Vec<_>>();
    get_rotate_crop_image(src, &box_points)
        .map_err(|error| format!("Failed to crop recognition region: {error}"))
}

/// Crop the axis-aligned bounding rectangle of an annotation polygon.
pub(crate) fn crop_bounding_rect(
    image: &RgbImage,
    points: &[[f32; 2]],
) -> Result<RgbImage, String> {
    let (x_min, y_min, x_max, y_max) = bounds(points)?;
    if x_max <= x_min || y_max <= y_min {
        return Err(INVALID_REGION.into());
    }

    let image_width = image.width() as f32;
    let image_height = image.height() as f32;
    let x0 = x_min.floor().clamp(0.0, image_width) as u32;
    let y0 = y_min.floor().clamp(0.0, image_height) as u32;
    let x1 = x_max.ceil().clamp(0.0, image_width) as u32;
    let y1 = y_max.ceil().clamp(0.0, image_height) as u32;
    if x1 <= x0 || y1 <= y0 {
        return Err("Recognition region is outside the image bounds".into());
    }

    Ok(image::imageops::crop_imm(image, x0, y0, x1 - x0, y1 - y0).to_image())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn order_quad_normalizes_unordered_points() {
        let ordered =
            order_quad(&[[10.0, 10.0], [0.0, 0.0], [0.0, 10.0], [10.0, 0.0]]).expect("valid quad");

        assert_eq!(
            ordered,
            [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]]
        );
    }

    #[test]
    fn crop_quad_rectifies_a_valid_region() {
        let src = RgbImage::from_pixel(4, 4, Rgb([12, 34, 56]));
        let crop = crop_quad(&src, &[[0.0, 0.0], [3.0, 0.0], [3.0, 2.0], [0.0, 2.0]])
            .expect("crop valid quad");

        assert_eq!((crop.width(), crop.height()), (3, 2));
    }

    #[test]
    fn crop_bounding_rect_clamps_to_image_bounds() {
        let src = RgbImage::from_pixel(4, 4, Rgb([12, 34, 56]));
        let crop = crop_bounding_rect(&src, &[[-2.0, -1.0], [3.0, -1.0], [3.0, 2.0], [-2.0, 2.0]])
            .expect("crop overlapping region");

        assert_eq!((crop.width(), crop.height()), (3, 2));
    }

    #[test]
    fn invalid_points_are_rejected() {
        assert!(order_quad(&[]).is_err());
        assert!(order_quad(&[[f32::NAN, 0.0]]).is_err());
    }
}
