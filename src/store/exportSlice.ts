import type { StateCreator } from "zustand";
import { mapLimited } from "@/lib/async";
import { resultLabel, resultText, type Point } from "@/types";
import type { AppState, ExportSlice, StoreRuntime } from "@/store/types";

const LOAD_IPC_CONCURRENCY = 8;

export const createExportSlice = (
  runtime: StoreRuntime,
): StateCreator<AppState, [], [], ExportSlice> =>
  (set, get) => ({
    exportRunning: false,
    exportTotal: 0,
    exportDone: 0,
    exportCancelRequested: false,
    exportSourceFailures: [],
    exportSourceSkipped: 0,
    exportableImages: async (kind) => {
      if (get().exportRunning || get().batchRunning) return null;
      const images = [...get().images];
      set({
        exportRunning: true,
        exportTotal: images.length,
        exportDone: 0,
        exportCancelRequested: false,
        exportSourceFailures: [],
        exportSourceSkipped: 0,
      });
      try {
        const collected = await mapLimited(
          images,
          LOAD_IPC_CONCURRENCY,
          async (image) => {
            try {
              const file = await runtime.annotationFileForExport(image.path);
              const matching = file.annotations.filter((annotation) => {
                const hasTask = (task: string) =>
                  annotation.results.some((result) => result.task === task);
                return kind === "layout"
                  ? hasTask("layout_detection")
                  : hasTask("text_detection") && hasTask("text_recognition");
              });
              const invalidGeometryCount = matching.filter(
                (annotation) => annotation.points.length < 3,
              ).length;
              const boxes = matching
                .filter((annotation) => annotation.points.length >= 3)
                .map((annotation) => ({
                  points: annotation.points.map(
                    (point) => [point[0], point[1]] as Point,
                  ),
                  transcription: resultText(annotation),
                  label: resultLabel(annotation),
                }));
              set((state) => ({
                exportDone: Math.min(state.exportTotal, state.exportDone + 1),
                exportSourceSkipped:
                  state.exportSourceSkipped +
                  file.skippedAnnotations +
                  invalidGeometryCount,
              }));
              return boxes.length ? { path: image.path, boxes } : null;
            } catch (error) {
              const detail = `${image.path}: ${String(error)}`;
              console.error(`Skipping unreadable annotation sidecar: ${detail}`);
              set((state) => ({
                exportDone: Math.min(state.exportTotal, state.exportDone + 1),
                exportSourceFailures: [...state.exportSourceFailures, detail],
                exportSourceSkipped: state.exportSourceSkipped + 1,
                annotationErrors: {
                  ...state.annotationErrors,
                  [image.path]: detail,
                },
              }));
              return null;
            }
          },
          () => !get().exportCancelRequested,
        );
        return get().exportCancelRequested
          ? null
          : collected.filter((item) => item != null);
      } finally {
        set({ exportRunning: false });
      }
    },
    requestExportCancel: () => {
      if (get().exportRunning) set({ exportCancelRequested: true });
    },
  });
