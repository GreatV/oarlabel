import Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from "react-konva";
import { useShallow } from "zustand/react/shallow";
import { fileSrc } from "@/lib/tauri";
import { t } from "@/i18n";
import { isTextInputTarget } from "@/lib/keyboard";
import { colorFor, usePalette, withAlpha } from "@/lib/palette";
import { useStore } from "@/store";
import type { FitMode, Point } from "@/types";

function useImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const im = new window.Image();
    let cancelled = false;
    im.onload = () => !cancelled && setImg(im);
    im.onerror = () => !cancelled && setImg(null);
    im.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return img;
}

function bbox(points: Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function clampPoint(p: Point, width: number, height: number): Point {
  return [
    Math.min(width, Math.max(0, p[0])),
    Math.min(height, Math.max(0, p[1])),
  ];
}

function clampZoom(scale: number): number {
  return Math.min(8, Math.max(0.1, scale));
}

function centerPan(
  viewport: { w: number; h: number },
  imageSize: { w: number; h: number },
  scale: number,
) {
  return {
    x: (viewport.w - imageSize.w * scale) / 2,
    y: (viewport.h - imageSize.h * scale) / 2,
  };
}

export function CanvasStage() {
  const locale = useStore((s) => s.locale);
  const img = useStore((s) => s.currentImage());
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const fitNonce = useStore((s) => s.fitNonce);
  const view = useStore(useShallow((s) => s.view));
  const selectedIds = useStore((s) => s.selectedIds);
  const annos = useStore((s) => s.currentAnnos());
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotationPoints = useStore((s) => s.updateAnnotationPoints);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const removeSelected = useStore((s) => s.removeSelected);
  const select = useStore((s) => s.select);
  const image = useImage(img ? fileSrc(img.path) : undefined);
  // Resolve palette colors (re-resolves on light/dark theme switch) so Konva,
  // which draws to <canvas> and can't read CSS var(--…), gets concrete colors.
  usePalette();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const activePathRef = useRef<string | null>(null);
  const autoFitModeRef = useRef<FitMode | null>("window");

  const [draftRect, setDraftRect] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null);
  const [draftPoly, setDraftPoly] = useState<Point[] | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  // Measure container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyFit = useCallback(
    (mode: FitMode) => {
      if (!image || !size.w || !size.h) return;
      let scale: number;
      if (mode === "actual") scale = 1;
      else if (mode === "width") scale = (size.w / image.width) * 0.98;
      else scale = Math.min(size.w / image.width, size.h / image.height) * 0.95;
      scale = clampZoom(scale);
      useStore.getState().setZoom(scale);
      const nextPan = centerPan(
        { w: size.w, h: size.h },
        { w: image.width, h: image.height },
        scale,
      );
      setPan({ x: nextPan.x, y: mode === "width" ? 16 : nextPan.y });
    },
    [image, size.h, size.w],
  );

  useEffect(() => {
    if (!image || !size.w || !size.h || !img) return;
    if (activePathRef.current !== img.path) {
      activePathRef.current = img.path;
      autoFitModeRef.current = "window";
    }
    if (autoFitModeRef.current) applyFit(autoFitModeRef.current);
  }, [applyFit, image, img, size.h, size.w]);

  // Respond to 视图 menu fit requests (window / width / actual).
  useEffect(() => {
    if (fitNonce === 0 || !image || !size.w || !size.h) return;
    const mode = useStore.getState().fitMode;
    if (!mode) return;
    autoFitModeRef.current = mode;
    applyFit(mode);
  }, [applyFit, fitNonce, image, size.h, size.w]);

  const toImage = (px: number, py: number): Point => {
    const p: Point = [(px - pan.x) / zoom, (py - pan.y) / zoom];
    return image ? clampPoint(p, image.width, image.height) : p;
  };

  const isBackground = (e: Konva.KonvaEventObject<unknown>) => {
    const name = e.target.name?.();
    return e.target === e.target.getStage() || name === "bg";
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!image) return;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    if (tool === "rect" && isBackground(e)) {
      const [x, y] = toImage(pointer.x, pointer.y);
      setDraftRect({ x0: x, y0: y, x1: x, y1: y });
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const p = toImage(pointer.x, pointer.y);
    if (draftRect) setDraftRect({ ...draftRect, x1: p[0], y1: p[1] });
    if (draftPoly) setCursor(p);
  };

  const handleMouseUp = () => {
    if (draftRect) {
      const { x0, y0, x1, y1 } = draftRect;
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      if (w > 4 && h > 4) {
        const minX = Math.min(x0, x1);
        const minY = Math.min(y0, y1);
        const maxX = Math.max(x0, x1);
        const maxY = Math.max(y0, y1);
        addAnnotation([
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ]);
      }
      setDraftRect(null);
    }
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "polygon" && isBackground(e)) {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const p = toImage(pointer.x, pointer.y);
      // close if near first point
      if (draftPoly && draftPoly.length >= 3) {
        const f = draftPoly[0];
        if (Math.hypot(f[0] - p[0], f[1] - p[1]) * zoom < 12) {
          addAnnotation(draftPoly);
          setDraftPoly(null);
          setCursor(null);
          return;
        }
      }
      setDraftPoly((prev) => (prev ? [...prev, p] : [p]));
    } else if (isBackground(e)) {
      select(null);
    }
  };

  const finishPolygon = () => {
    if (draftPoly && draftPoly.length >= 3) addAnnotation(draftPoly);
    setDraftPoly(null);
    setCursor(null);
  };

  // Keyboard: finish/cancel polygon, delete selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextInputTarget(e.target)) return;
      if (e.key === "Enter" && draftPoly) finishPolygon();
      else if (e.key === "Escape") {
        setDraftPoly(null);
        setDraftRect(null);
        setCursor(null);
        select(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length) {
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPoly, selectedIds.length]);

  const stroke = 2 / zoom;
  const tagFont = 12 / zoom;
  const tagW = 18 / zoom;
  const tagH = 16 / zoom;
  const draggable = tool === "select";

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-canvas"
      style={{
        cursor:
          tool === "rect" || tool === "polygon"
            ? "crosshair"
            : tool === "delete"
              ? "not-allowed"
              : "default",
      }}
    >
      {!img && (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <div className="rounded-md border border-dashed bg-card/70 px-5 py-4 text-sm text-muted-foreground">
            {t(locale, "canvas.empty")}
          </div>
        </div>
      )}
      {img && size.w > 0 && (
        <Stage
          width={size.w}
          height={size.h}
          scaleX={zoom}
          scaleY={zoom}
          x={pan.x}
          y={pan.y}
          draggable={draggable}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onDragEnd={(e) => {
            // only the stage itself updates pan
            if (e.target === e.target.getStage()) {
              autoFitModeRef.current = null;
              setPan({ x: e.target.x(), y: e.target.y() });
            }
          }}
        >
          <Layer>
            {image && (
              <KonvaImage
                image={image}
                name="bg"
                width={image.width}
                height={image.height}
              />
            )}
          </Layer>
          <Layer>
            {view.boxes &&
              annos.map((a, i) => {
              const color = colorFor(i);
              const b = bbox(a.points);
              const selected = selectedIds.includes(a.id);
              const hovered = hoveredId === a.id;
              // Default: thin outline + near-transparent tint so the underlying
              // invoice text stays readable. Emphasize on hover/selection only.
              const emphasized = selected || (hovered && view.highlight);
              const lineStroke = emphasized ? stroke * 1.8 : stroke;
              const fillAlpha = emphasized ? 0.18 : 0.05;
              const flat = a.points.flat();
              return (
                <Group
                  key={a.id}
                  draggable={selected && tool === "select"}
                    onDragEnd={(e) => {
                      const dx = e.target.x();
                      const dy = e.target.y();
                      if (dx === 0 && dy === 0) return;
                      updateAnnotationPoints(
                        a.id,
                        a.points.map((p) =>
                          image
                            ? clampPoint([p[0] + dx, p[1] + dy], image.width, image.height)
                            : ([p[0] + dx, p[1] + dy] as Point),
                        ),
                      );
                    e.target.position({ x: 0, y: 0 });
                  }}
                  onMouseDown={(e) => {
                    if (tool === "delete") {
                      e.cancelBubble = true;
                      removeAnnotation(a.id);
                    } else if (tool === "select" || tool === "edit") {
                      e.cancelBubble = true;
                      select(a.id, e.evt.ctrlKey || e.evt.metaKey);
                    }
                  }}
                  onMouseEnter={() => setHoveredId(a.id)}
                  onMouseLeave={() =>
                    setHoveredId((cur) => (cur === a.id ? null : cur))
                  }
                >
                  <Line
                    points={flat}
                    closed
                    stroke={color}
                    strokeWidth={lineStroke}
                    fill={withAlpha(color, fillAlpha)}
                    hitStrokeWidth={Math.max(10, stroke * 4)}
                  />
                  {/* number tag */}
                  {view.labels && (
                    <>
                      <Rect
                        x={b.x}
                        y={b.y}
                        width={tagW}
                        height={tagH}
                        fill={color}
                        cornerRadius={2 / zoom}
                      />
                      <Text
                        x={b.x}
                        y={b.y + 1 / zoom}
                        width={tagW}
                        height={tagH}
                        text={String(i + 1)}
                        fontSize={tagFont}
                        fill="#fff"
                        align="center"
                        verticalAlign="middle"
                      />
                    </>
                  )}
                  {/* edit handles */}
                  {selected &&
                    tool === "edit" &&
                    a.points.map((p, vi) => (
                      <Circle
                        key={vi}
                        x={p[0]}
                        y={p[1]}
                        radius={5 / zoom}
                        fill="#fff"
                        stroke={color}
                        strokeWidth={1.5 / zoom}
                        draggable
                        onDragEnd={(e) => {
                          const np = a.points.map((q, qi) =>
                            qi === vi
                              ? image
                                ? clampPoint([e.target.x(), e.target.y()], image.width, image.height)
                                : ([e.target.x(), e.target.y()] as Point)
                              : q,
                          );
                          updateAnnotationPoints(a.id, np);
                        }}
                      />
                    ))}
                </Group>
              );
            })}

            {/* draft rectangle */}
            {draftRect && (
              <Rect
                x={Math.min(draftRect.x0, draftRect.x1)}
                y={Math.min(draftRect.y0, draftRect.y1)}
                width={Math.abs(draftRect.x1 - draftRect.x0)}
                height={Math.abs(draftRect.y1 - draftRect.y0)}
                stroke="#2563eb"
                dash={[6 / zoom, 4 / zoom]}
                strokeWidth={stroke}
                fill="#2563eb22"
              />
            )}

            {/* draft polygon */}
            {draftPoly && (
              <>
                <Line
                  points={[...draftPoly, ...(cursor ? [cursor] : [])].flat()}
                  stroke="#2563eb"
                  strokeWidth={stroke}
                  dash={[6 / zoom, 4 / zoom]}
                />
                {draftPoly.map((p, i) => (
                  <Circle
                    key={i}
                    x={p[0]}
                    y={p[1]}
                    radius={4 / zoom}
                    fill={i === 0 ? "#dc2626" : "#2563eb"}
                  />
                ))}
              </>
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
