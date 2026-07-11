import type { StateCreator } from "zustand";
import { t, tt } from "@/i18n";
import { inferAnnotationShape } from "@/lib/annotationFile";
import { clampZoom } from "@/lib/constants";
import { resultLabel, resultText, type Point } from "@/types";
import {
  cloneAnnotation,
  currentLabel,
  isBulkRecognitionTarget,
  manualResults,
  markGeometryManual,
  newId,
  setLabelResult,
  setTextResult,
} from "@/store/annotationModel";
import type {
  AnnotationSlice,
  AppState,
  HistorySnapshot,
  StoreRuntime,
} from "@/store/types";

export const createAnnotationSlice = (
  runtime: StoreRuntime,
): StateCreator<AppState, [], [], AnnotationSlice> =>
  (set, get) => ({
    annos: {},
    selectedIds: [],
    selectedId: null,
    clipboard: [],
    mode: "ocr",
    tool: "select",
    zoom: 1,
    fitMode: null,
    fitNonce: 0,
    past: {},
    future: {},

    setMode: (mode) => set({ mode, selectedIds: [], selectedId: null }),
    setTool: (tool) => set({ tool }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    requestFit: (mode) => set((state) => ({ fitMode: mode, fitNonce: state.fitNonce + 1 })),
    select: (id, additive = false) => {
      if (id === null) {
        set({ selectedIds: [], selectedId: null });
      } else if (!additive) {
        set({ selectedIds: [id], selectedId: id });
      } else {
        set((state) => {
          const ids = state.selectedIds.includes(id)
            ? state.selectedIds.filter((selected) => selected !== id)
            : [...state.selectedIds, id];
          return { selectedIds: ids, selectedId: ids[ids.length - 1] ?? null };
        });
      }
    },
    selectAll: () => {
      const ids = get().currentAnnos().map((annotation) => annotation.id);
      set({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? null });
    },
    clearSelection: () => set({ selectedIds: [], selectedId: null }),
    addAnnotation: (points, label, shape) => {
      const id = newId();
      const added = runtime.mutate((previous) =>
        previous.concat({
          id,
          points,
          shape: shape ?? inferAnnotationShape(points),
          results: manualResults(currentLabel(get().mode, label)),
        }),
      );
      if (added) set({ selectedIds: [id], selectedId: id });
    },
    updateAnnotationPoints: (id, points) =>
      runtime.mutate((previous) =>
        previous.map((annotation) =>
          annotation.id === id ? { ...markGeometryManual(annotation), points } : annotation,
        ),
      ),
    updateAnnotationsPoints: (updates) => {
      if (!Object.keys(updates).length) return;
      runtime.mutate((previous) =>
        previous.map((annotation) => {
          const points = updates[annotation.id];
          return points ? { ...markGeometryManual(annotation), points } : annotation;
        }),
      );
    },
    setText: (id, text) => {
      const current = get().currentAnnos().find((annotation) => annotation.id === id);
      if (
        current?.results.some((result) => result.task === "text_recognition") &&
        resultText(current) === text
      ) {
        return;
      }
      runtime.mutate((previous) =>
        previous.map((annotation) =>
          annotation.id === id ? setTextResult(annotation, text) : annotation,
        ),
      );
    },
    ensureTextResult: (id) => {
      const current = get().currentAnnos().find((annotation) => annotation.id === id);
      if (!current || current.results.some((result) => result.task === "text_recognition")) return;
      runtime.mutate((previous) =>
        previous.map((annotation) =>
          annotation.id === id ? setTextResult(annotation, "") : annotation,
        ),
      );
    },
    setAnnotationHidden: (id, hidden) => {
      const current = get().currentAnnos().find((annotation) => annotation.id === id);
      if (!current || current.hidden === hidden) return;
      runtime.mutate((previous) =>
        previous.map((annotation) =>
          annotation.id === id ? { ...annotation, hidden } : annotation,
        ),
        { preserveStatus: true },
      );
    },
    setLabel: (id, label) => {
      const current = get().currentAnnos().find((annotation) => annotation.id === id);
      if (current && resultLabel(current) === label) return;
      runtime.mutate((previous) =>
        previous.map((annotation) =>
          annotation.id === id ? setLabelResult(annotation, label) : annotation,
        ),
      );
    },
    removeAnnotation: (id) => {
      if (!runtime.mutate((previous) => previous.filter((annotation) => annotation.id !== id))) {
        return;
      }
      set((state) => {
        const ids = state.selectedIds.filter((selected) => selected !== id);
        return { selectedIds: ids, selectedId: ids[ids.length - 1] ?? null };
      });
    },
    removeSelected: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      if (runtime.mutate((previous) => previous.filter((annotation) => !ids.has(annotation.id)))) {
        set({ selectedIds: [], selectedId: null });
      }
    },
    copySelection: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      const copied = get()
        .currentAnnos()
        .filter((annotation) => ids.has(annotation.id))
        .map(cloneAnnotation);
      if (copied.length) {
        set({
          clipboard: copied,
          statusMsg: tt(get().locale, "message.copiedBoxes", { count: copied.length }),
        });
      }
    },
    paste: () => get().pasteAt(),
    pasteAt: (anchor) => {
      const image = get().currentImage();
      const clipboard = get().clipboard;
      if (!image || !clipboard.length) return;
      const allPoints = clipboard.flatMap((annotation) => annotation.points);
      const minX = Math.min(...allPoints.map((point) => point[0]));
      const minY = Math.min(...allPoints.map((point) => point[1]));
      const maxX = Math.max(...allPoints.map((point) => point[0]));
      const maxY = Math.max(...allPoints.map((point) => point[1]));
      const requestedDx = anchor ? anchor[0] - minX : 8;
      const requestedDy = anchor ? anchor[1] - minY : 8;
      const dx = image.width
        ? Math.min(image.width - maxX, Math.max(-minX, requestedDx))
        : requestedDx;
      const dy = image.height
        ? Math.min(image.height - maxY, Math.max(-minY, requestedDy))
        : requestedDy;
      const newIds: string[] = [];
      const pasted = runtime.mutate((previous) =>
        previous.concat(
          clipboard.map((annotation) => {
            const id = newId();
            newIds.push(id);
            const cloned = cloneAnnotation(annotation);
            return {
              ...cloned,
              id,
              points: cloned.points.map(
                (point) => [point[0] + dx, point[1] + dy] as Point,
              ),
            };
          }),
        ),
      );
      if (pasted) {
        set({ selectedIds: newIds, selectedId: newIds[newIds.length - 1] ?? null });
      }
    },
    recognizeSelectedText: async () => {
      if (get().batchRunning) return;
      if (get().mode === "layout") {
        set({ statusMsg: t(get().locale, "message.recognitionUnavailableInLayout") });
        return;
      }
      const selected = new Set(get().selectedIds);
      if (!selected.size) {
        set({ statusMsg: t(get().locale, "message.recognizeTextNoSelection") });
        return;
      }
      const annotations = get().currentAnnos().filter((annotation) => selected.has(annotation.id));
      await (get().mode === "formula"
        ? runtime.recognizeFormulaForAnnotations(annotations)
        : runtime.recognizeTextForAnnotations(annotations));
    },
    recognizeAllTextBoxes: async () => {
      if (get().batchRunning) return;
      const mode = get().mode;
      const annotations = get()
        .currentAnnos()
        .filter((annotation) => isBulkRecognitionTarget(annotation, mode));
      await (mode === "formula"
        ? runtime.recognizeFormulaForAnnotations(annotations)
        : runtime.recognizeTextForAnnotations(annotations));
    },
    undo: () => moveHistory("undo", set, get),
    redo: () => moveHistory("redo", set, get),
  });

function moveHistory(
  direction: "undo" | "redo",
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1],
): void {
  if (get().busy) return;
  const image = get().currentImage();
  if (!image) return;
  const path = image.path;
  if (get().batchPendingPaths[path]) return;
  set((state) => {
    const source = direction === "undo" ? state.past[path] ?? [] : state.future[path] ?? [];
    if (!source.length) return {};
    const target = source[source.length - 1];
    const current: HistorySnapshot = {
      annotations: state.annos[path] ?? [],
      status: state.images.find((item) => item.path === path)?.status ?? image.status,
      dirty: state.dirtyPaths[path] === true,
    };
    const selected = new Set(target.annotations.map((annotation) => annotation.id));
    const selectedIds = state.selectedIds.filter((id) => selected.has(id));
    const dirtyPaths = { ...state.dirtyPaths };
    if (target.dirty) dirtyPaths[path] = true;
    else delete dirtyPaths[path];
    const common = {
      annos: { ...state.annos, [path]: target.annotations },
      images: state.images.map((item) =>
        item.path === path ? { ...item, status: target.status } : item,
      ),
      dirty: Object.keys(dirtyPaths).length > 0,
      dirtyPaths,
      selectedIds,
      selectedId: selectedIds[selectedIds.length - 1] ?? null,
    };
    return direction === "undo"
      ? {
          ...common,
          past: { ...state.past, [path]: source.slice(0, -1) },
          future: { ...state.future, [path]: (state.future[path] ?? []).concat(current) },
        }
      : {
          ...common,
          future: { ...state.future, [path]: source.slice(0, -1) },
          past: { ...state.past, [path]: (state.past[path] ?? []).concat(current) },
        };
  });
}
