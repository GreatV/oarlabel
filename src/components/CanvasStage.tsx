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
import { t, tt } from "@/i18n";
import { isTextInputTarget } from "@/lib/keyboard";
import { colorFor, usePalette, withAlpha } from "@/lib/palette";
import { useStore } from "@/store";
import type { Annotation, FitMode, Point } from "@/types";
import { resultReadingIndex } from "@/types";

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

/** Reduce arbitrary points to the axis-aligned rect they span, ordered
 *  [TL, TR, BR, BL] — the canonical order the rect draw path commits in. */
function rectFromPoints(points: Point[]): [Point, Point, Point, Point] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
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
  const minBoxSize = useStore((s) => s.minBoxSize);
  const img = useStore((s) => s.currentImage());
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const fitNonce = useStore((s) => s.fitNonce);
  const view = useStore(useShallow((s) => s.view));
  const selectedIds = useStore((s) => s.selectedIds);
  const annos = useStore((s) => s.currentAnnos());
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotationPoints = useStore((s) => s.updateAnnotationPoints);
  const moveAnnotationTree = useStore((s) => s.moveAnnotationTree);
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
  // Track the origin of the last zoom change so the re-anchor effect only runs
  // for keyboard / external zoom edits, not for wheel or fit (which set their
  // own pan). prevZoomRef holds the zoom the pan was computed against.
  const zoomSrcRef = useRef<"wheel" | "fit" | "external">("external");
  const prevZoomRef = useRef<number>(zoom);

  const [draftRect, setDraftRect] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null);
  const [draftPoly, setDraftPoly] = useState<Point[] | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [closePulse, setClosePulse] = useState(0);
  // Transient override of the in-edit annotation's points while a vertex or
  // resize handle is being dragged. The Line reads this in preference to the
  // committed points so the outline follows the pointer live; onDragEnd
  // commits the final points to the store and clears this back to null.
  const [dragPts, setDragPts] = useState<Point[] | null>(null);
  // Which annotation id dragPts applies to (ignored when dragPts is null).
  const [dragId, setDragId] = useState<string | null>(null);
  const polygonCloseReady =
    !!draftPoly &&
    draftPoly.length >= 3 &&
    !!cursor &&
    Math.hypot(draftPoly[0][0] - cursor[0], draftPoly[0][1] - cursor[1]) * zoom <= 22;

  // Clear any in-progress rectangle/polygon when the displayed image changes,
  // otherwise a half-drawn polygon carries over onto the next image and closes
  // there with the previous clicks.
  useEffect(() => {
    setDraftRect(null);
    setDraftPoly(null);
    setCursor(null);
    setDragPts(null);
    setDragId(null);
  }, [img?.path]);

  useEffect(() => {
    setDraftRect(null);
    setDraftPoly(null);
    setCursor(null);
  }, [tool]);

  useEffect(() => {
    if (!polygonCloseReady) {
      setClosePulse(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setClosePulse(((now - start) % 900) / 900);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [polygonCloseReady]);

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
      // Keep the zoom refs consistent. When scale === zoom, setZoom is a no-op
      // so the [zoom] effect below won't run and reset the refs — so we must
      // leave zoomSrcRef as "external" (not "fit") and sync prevZoomRef here,
      // otherwise the next external (keyboard) zoom would mis-anchor using a
      // stale prevZoomRef / be skipped as a "fit" tag.
      const changed = scale !== zoom;
      if (changed) zoomSrcRef.current = "fit";
      prevZoomRef.current = scale;
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
    const name = e.target.name();
    return e.target === e.target.getStage() || name === "bg";
  };

  // Cursor-anchored zoom: keep the image point under the pointer fixed as the
  // scale changes, so the view zooms toward the cursor instead of jumping.
  // The math is the inverse of toImage(): given screen pointer s and pan p,
  // image point = (s - p) / z. To keep (s - p1)/z1 == (s - p0)/z0 solve for p1.
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      if (!image || !size.w || !size.h) return;
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      e.evt.preventDefault();
      const factor = e.evt.deltaY < 0 ? 1.12 : 1 / 1.12;
      const z0 = zoom;
      const z1 = clampZoom(z0 * factor);
      if (z1 === z0) return;
      const nx = pointer.x - (pointer.x - pan.x) * (z1 / z0);
      const ny = pointer.y - (pointer.y - pan.y) * (z1 / z0);
      zoomSrcRef.current = "wheel";
      useStore.getState().setZoom(z1);
      setPan({ x: nx, y: ny });
      autoFitModeRef.current = null;
    },
    [image, pan.x, pan.y, size.h, size.w, zoom],
  );

  // When zoom changes from outside the wheel handler (keyboard Ctrl+=/-, the
  // View menu, or fit), re-anchor pan to the viewport center so the image
  // doesn't drift off-screen. The wheel path sets zoomSrcRef to skip this.
  useEffect(() => {
    if (zoomSrcRef.current === "wheel" || zoomSrcRef.current === "fit") {
      // wheel sets its own pan; fit centers explicitly. Just sync prevZoom.
      zoomSrcRef.current = "external";
      prevZoomRef.current = zoom;
      return;
    }
    if (!image || !size.w || !size.h) return;
    const cx = size.w / 2;
    const cy = size.h / 2;
    // Keep the image point currently at the viewport center fixed under the new
    // zoom (same anchor math as the wheel handler, centered instead of pointer).
    const nx = cx - (cx - pan.x) * (zoom / prevZoomRef.current);
    const ny = cy - (cy - pan.y) * (zoom / prevZoomRef.current);
    prevZoomRef.current = zoom;
    setPan({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!image) return;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    if (tool === "rect") {
      // Allow starting a rectangle anywhere, including over existing boxes —
      // dense documents otherwise leave almost no blank space to begin a drag.
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
      if (w >= minBoxSize && h >= minBoxSize) {
        const minX = Math.min(x0, x1);
        const minY = Math.min(y0, y1);
        const maxX = Math.max(x0, x1);
        const maxY = Math.max(y0, y1);
        addAnnotation(
          [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
          ],
          undefined,
          "rect",
        );
      } else {
        useStore.setState({
          statusMsg: tt(locale, "message.boxTooSmall", { size: minBoxSize }),
        });
      }
      setDraftRect(null);
    }
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "polygon") {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      if (e.evt.detail > 1) {
        if (draftPoly && draftPoly.length >= 3) finishPolygon();
        return;
      }
      const p = toImage(pointer.x, pointer.y);
      // Close if the click lands near the first point. Use screen distance so
      // the target remains easy to hit regardless of zoom level.
      if (draftPoly && draftPoly.length >= 3) {
        const f = draftPoly[0];
        if (Math.hypot(f[0] - p[0], f[1] - p[1]) * zoom <= 22) {
          addAnnotation(draftPoly, undefined, "polygon");
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
    if (draftPoly && draftPoly.length >= 3) {
      addAnnotation(draftPoly, undefined, "polygon");
    }
    setDraftPoly(null);
    setCursor(null);
  };

  // Keyboard: finish/cancel polygon, delete selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextInputTarget(e.target)) return;
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && draftPoly) finishPolygon();
      else if (e.key === "Escape") {
        setDraftPoly(null);
        setDraftRect(null);
        setCursor(null);
        select(null);
      } else if ((e.key === "Backspace" || e.key === "Delete") && draftPoly) {
        e.preventDefault();
        setDraftPoly((prev) => {
          if (!prev || prev.length <= 1) {
            setCursor(null);
            return null;
          }
          return prev.slice(0, -1);
        });
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

  /** Render the edit handles for a selected annotation. Rect annotations get
   *  8 resize handles (4 corners + 4 edge midpoints) that keep the shape
   *  rectangular; polygons fall back to one handle per vertex. Both modes
   *  preview live via dragPts and commit on dragEnd. */
  const editHandlesFor = (
    anno: Pick<Annotation, "id" | "points" | "shape">,
    livePts: Point[],
    color: string,
  ) => {
    const commit = (next: Point[]) => {
      updateAnnotationPoints(anno.id, next);
      setDragPts(null);
      setDragId(null);
    };
    const startDrag = () => setDragId(anno.id);

    if (anno.shape === "rect") {
      const [tl, tr, br, bl] = rectFromPoints(livePts);
      const corners: { p: Point; vi: 0 | 1 | 2 | 3 }[] = [
        { p: tl, vi: 0 },
        { p: tr, vi: 1 },
        { p: br, vi: 2 },
        { p: bl, vi: 3 },
      ];
      // Edge midpoints; vi flags which sides the handle moves.
      const edges: { p: Point; type: "n" | "e" | "s" | "w" }[] = [
        { p: [(tl[0] + tr[0]) / 2, tl[1]], type: "n" },
        { p: [tr[0], (tr[1] + br[1]) / 2], type: "e" },
        { p: [(bl[0] + br[0]) / 2, br[1]], type: "s" },
        { p: [bl[0], (tl[1] + bl[1]) / 2], type: "w" },
      ];
      const resizeTo = (next: [Point, Point, Point, Point]) => {
        // Enforce the configured minimum so a corner/edge can't invert or
        // collapse the box.
        const [a, b, c, d] = next;
        const minX = Math.min(a[0], b[0], c[0], d[0]);
        const maxX = Math.max(a[0], b[0], c[0], d[0]);
        const minY = Math.min(a[1], b[1], c[1], d[1]);
        const maxY = Math.max(a[1], b[1], c[1], d[1]);
        if (maxX - minX < minBoxSize || maxY - minY < minBoxSize) return;
        setDragPts(next);
      };
      return (
        <>
          {corners.map(({ p, vi }) => (
            <Circle
              key={`c${vi}`}
              x={p[0]}
              y={p[1]}
              radius={5 / zoom}
              fill="#fff"
              stroke={color}
              strokeWidth={1.5 / zoom}
              draggable
              onDragStart={startDrag}
              onDragMove={(e) => {
                const raw = image
                  ? clampPoint([e.target.x(), e.target.y()], image.width, image.height)
                  : ([e.target.x(), e.target.y()] as Point);
                const [nx, ny] = raw;
                // Pin the opposite corner; vary this corner along both axes.
                const opp = corners[(vi + 2) % 4].p;
                resizeTo([
                  [Math.min(nx, opp[0]), Math.min(ny, opp[1])],
                  [Math.max(nx, opp[0]), Math.min(ny, opp[1])],
                  [Math.max(nx, opp[0]), Math.max(ny, opp[1])],
                  [Math.min(nx, opp[0]), Math.max(ny, opp[1])],
                ]);
              }}
              onDragEnd={() => {
                if (dragPts && dragId === anno.id) commit(dragPts);
              }}
            />
          ))}
          {edges.map(({ p, type }) => (
            <Rect
              key={`e${type}`}
              x={p[0] - 4 / zoom}
              y={p[1] - 4 / zoom}
              width={8 / zoom}
              height={8 / zoom}
              fill="#fff"
              stroke={color}
              strokeWidth={1.5 / zoom}
              draggable
              onDragStart={startDrag}
              onDragMove={(e) => {
                const raw = image
                  ? clampPoint([e.target.x(), e.target.y()], image.width, image.height)
                  : ([e.target.x(), e.target.y()] as Point);
                const [nx, ny] = raw;
                // Pin the opposite edge; vary the dragged edge along one axis.
                // The configured minimum is enforced by resizeTo, which drops
                // updates that would collapse the box below the threshold.
                let minX = tl[0];
                let maxX = br[0];
                let minY = tl[1];
                let maxY = br[1];
                if (type === "n") minY = ny;
                else if (type === "s") maxY = ny;
                else if (type === "w") minX = nx;
                else maxX = nx;
                resizeTo([
                  [minX, minY],
                  [maxX, minY],
                  [maxX, maxY],
                  [minX, maxY],
                ]);
              }}
              onDragEnd={() => {
                if (dragPts && dragId === anno.id) commit(dragPts);
              }}
            />
          ))}
        </>
      );
    }

    // Polygon: one handle per vertex.
    return (
      <>
        {anno.points.map((p, vi) => (
          <Circle
            key={vi}
            x={p[0]}
            y={p[1]}
            radius={5 / zoom}
            fill="#fff"
            stroke={color}
            strokeWidth={1.5 / zoom}
            draggable
            onDragStart={startDrag}
            onDragMove={(e) => {
              const np = livePts.map((q, qi) =>
                qi === vi
                  ? image
                    ? clampPoint([e.target.x(), e.target.y()], image.width, image.height)
                    : ([e.target.x(), e.target.y()] as Point)
                  : q,
              );
              setDragPts(np);
            }}
            onDragEnd={(e) => {
              const np = anno.points.map((q, qi) =>
                qi === vi
                  ? image
                    ? clampPoint([e.target.x(), e.target.y()], image.width, image.height)
                    : ([e.target.x(), e.target.y()] as Point)
                  : q,
              );
              commit(np);
            }}
          />
        ))}
      </>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-canvas"
      style={{
        cursor: tool === "rect" || tool === "polygon" ? "crosshair" : "default",
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
          onWheel={handleWheel}
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
              (() => {
              // Render parents first (filled regions) then their children on
              // top, and give children their parent's color so a region and its
              // text/formula/table lines read as one visual group. Top-level
              // boxes without children (single-mode output, manual boxes) keep
              // the flat-index color they always had.
              const childrenOf = new Map<string, typeof annos>();
              for (const a of annos) {
                if (!a.parentId) continue;
                const arr = childrenOf.get(a.parentId) ?? [];
                arr.push(a);
                childrenOf.set(a.parentId, arr);
              }
              const ordered: typeof annos = [];
              for (const a of annos) {
                if (a.parentId) continue;
                ordered.push(a);
                const kids = childrenOf.get(a.id);
                if (kids) ordered.push(...kids);
              }
              const colorOf = (a: (typeof annos)[number], i: number): string => {
                if (a.parentId) {
                  const parent = annos.find((p) => p.id === a.parentId);
                  if (parent) {
                    const pi = annos.filter((x) => !x.parentId).indexOf(parent);
                    if (pi >= 0) return colorFor(pi);
                  }
                }
                return colorFor(i);
              };
              return ordered.map((a, i) => {
              if (a.hidden) return null;
              const color = colorOf(a, i);
              const b = bbox(a.points);
              const selected = selectedIds.includes(a.id);
              const hovered = hoveredId === a.id;
              // Default: thin outline + near-transparent tint so the underlying
              // invoice text stays readable. Emphasize on hover/selection only.
              const emphasized = selected || (hovered && view.highlight);
              const lineStroke = emphasized ? stroke * 1.8 : stroke;
              const fillAlpha = emphasized ? 0.18 : 0.05;
              // Children draw as thinner outlines so the parent region's fill
              // stays dominant; parents keep the filled tint.
              const isChild = !!a.parentId;
              // While dragging a vertex/resize handle on this annotation, show
              // the transient points so the outline tracks the pointer live.
              const livePts = dragPts && dragId === a.id ? dragPts : a.points;
              const flat = livePts.flat();
              const numberTagX = b.x;
              const numberTagY = b.y - tagH - 2 / zoom;
              return (
                  <Group
                  key={a.id}
                  draggable={selected && tool === "select"}
                    onDragEnd={(e) => {
                      if (e.target !== e.currentTarget) return;
                      const dx = e.target.x();
                      const dy = e.target.y();
                      if (dx === 0 && dy === 0) return;
                      // A region with children moves the whole tree in one
                      // undo step; a childless box just shifts its own points.
                      if (childrenOf.get(a.id)?.length) {
                        moveAnnotationTree(a.id, dx, dy);
                      } else {
                        updateAnnotationPoints(
                          a.id,
                          a.points.map((p) =>
                            image
                              ? clampPoint([p[0] + dx, p[1] + dy], image.width, image.height)
                              : ([p[0] + dx, p[1] + dy] as Point),
                          ),
                        );
                      }
                    e.target.position({ x: 0, y: 0 });
                  }}
                  onMouseDown={(e) => {
                    if (tool === "select") {
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
                    // Children (text/formula/table lines inside a region) render
                    // as a thinner outline so the parent region's fill stays
                    // the dominant visual; parents keep the filled tint.
                    strokeWidth={isChild ? lineStroke * 0.7 : lineStroke}
                    fill={withAlpha(color, isChild && !emphasized ? fillAlpha * 0.5 : fillAlpha)}
                    hitStrokeWidth={Math.max(10, stroke * 4)}
                  />
                  {/* number tag */}
                  {view.labels && (
                    <>
                      <Rect
                        x={numberTagX}
                        y={numberTagY}
                        width={tagW}
                        height={tagH}
                        fill={color}
                        cornerRadius={2 / zoom}
                      />
                      <Text
                        x={numberTagX}
                        y={numberTagY + 1 / zoom}
                        width={tagW}
                        height={tagH}
                        // Reading-order mode tags each box with a logical index;
                        // prefer it over the array position so the on-canvas
                        // number matches the exported reading sequence.
                        text={String((resultReadingIndex(a) ?? i) + 1)}
                        fontSize={tagFont}
                        fill="#fff"
                        align="center"
                        verticalAlign="middle"
                      />
                    </>
                  )}
                  {/* Edit handles. Rect annotations get 8 resize handles
                      (corners + edge midpoints) that preserve the rectangle;
                      everything else falls back to per-vertex editing. Both
                      paths preview through dragPts so the outline follows the
                      pointer live, committing only on dragEnd. */}
                  {selected && tool === "select" && editHandlesFor(a, livePts, color)}
                </Group>
              );
            });
            })()}

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
                  <Group key={i}>
                    {i === 0 && polygonCloseReady && (
                      <Circle
                        x={p[0]}
                        y={p[1]}
                        radius={(10 + closePulse * 8) / zoom}
                        stroke="#dc2626"
                        strokeWidth={2 / zoom}
                        opacity={0.55 * (1 - closePulse)}
                        listening={false}
                      />
                    )}
                    <Circle
                      x={p[0]}
                      y={p[1]}
                      radius={(i === 0 && polygonCloseReady ? 6 : 4) / zoom}
                      fill={i === 0 ? "#dc2626" : "#2563eb"}
                      stroke={i === 0 && polygonCloseReady ? "#fff" : undefined}
                      strokeWidth={i === 0 && polygonCloseReady ? 2 / zoom : 0}
                    />
                  </Group>
                ))}
              </>
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
