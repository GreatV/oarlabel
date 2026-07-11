import { describe, expect, it } from "vitest";
import {
  anchoredZoomPan,
  bbox,
  centerPan,
  clampPoint,
  rectFromPoints,
  rectMeetsMinimumSize,
} from "@/lib/canvasGeometry";

describe("canvas geometry", () => {
  it("normalizes rectangles and bounds", () => {
    const points: [number, number][] = [[8, 7], [2, 3], [8, 3], [2, 7]];
    expect(bbox(points)).toEqual({ x: 2, y: 3, maxX: 8, maxY: 7 });
    expect(rectFromPoints(points)).toEqual([[2, 3], [8, 3], [8, 7], [2, 7]]);
  });

  it("clamps points and centers zoomed images", () => {
    expect(clampPoint([-2, 12], 10, 8)).toEqual([0, 8]);
    expect(centerPan({ w: 100, h: 80 }, { w: 20, h: 10 }, 2)).toEqual({
      x: 30,
      y: 30,
    });
  });

  it("validates resize minimums without accepting inverted edges", () => {
    expect(rectMeetsMinimumSize([[0, 0], [5, 0], [5, 4], [0, 4]], 4)).toBe(true);
    expect(rectMeetsMinimumSize([[0, 0], [3, 0], [3, 4], [0, 4]], 4)).toBe(false);
    expect(rectMeetsMinimumSize([[0, 5], [5, 5], [5, 0], [0, 0]], 4)).toBe(false);
  });

  it("keeps the image point under the zoom anchor fixed", () => {
    const nextPan = anchoredZoomPan([100, 80], [20, 10], 2, 4);
    expect(nextPan).toEqual([-60, -60]);
    expect((100 - nextPan[0]) / 4).toBe((100 - 20) / 2);
    expect((80 - nextPan[1]) / 4).toBe((80 - 10) / 2);
  });
});
