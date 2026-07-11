import type { Point } from "@/types";

export function bbox(points: Point[]) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return [
    Math.min(width, Math.max(0, point[0])),
    Math.min(height, Math.max(0, point[1])),
  ];
}

export function rectFromPoints(points: Point[]): [Point, Point, Point, Point] {
  const { x, y, maxX, maxY } = bbox(points);
  return [
    [x, y],
    [maxX, y],
    [maxX, maxY],
    [x, maxY],
  ];
}

export function rectMeetsMinimumSize(points: Point[], minimum: number): boolean {
  if (points.length !== 4) return false;
  const width = points[1][0] - points[0][0];
  const height = points[3][1] - points[0][1];
  return width >= minimum && height >= minimum;
}

/** Keep the image-space point under a screen-space anchor fixed while zooming. */
export function anchoredZoomPan(
  anchor: Point,
  pan: Point,
  previousZoom: number,
  nextZoom: number,
): Point {
  const ratio = nextZoom / previousZoom;
  return [
    anchor[0] - (anchor[0] - pan[0]) * ratio,
    anchor[1] - (anchor[1] - pan[1]) * ratio,
  ];
}

export function centerPan(
  viewport: { w: number; h: number },
  imageSize: { w: number; h: number },
  scale: number,
) {
  return {
    x: (viewport.w - imageSize.w * scale) / 2,
    y: (viewport.h - imageSize.h * scale) / 2,
  };
}
