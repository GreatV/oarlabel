import type { StateCreator } from "zustand";
import { t, tt } from "@/i18n";
import { mapLimited } from "@/lib/async";
import {
  api,
  confirmReplaceAnnotations,
  confirmReplaceBatchAnnotations,
} from "@/lib/tauri";
import { appendSkipped } from "@/store/messages";
import type { AppState, BatchSlice, StoreRuntime } from "@/store/types";

const INFERENCE_CONCURRENCY = 2;

export const createBatchSlice = (
  runtime: StoreRuntime,
): StateCreator<AppState, [], [], BatchSlice> =>
  (set, get) => ({
    batchRunning: false,
    batchPhase: null,
    batchTotal: 0,
    batchDone: 0,
    batchFailures: [],
    batchCancelRequested: false,
    batchActivePath: null,
    batchPendingPaths: {},
    preannotateCurrent: async () => {
      const image = get().currentImage();
      if (!image || get().busy || get().batchRunning) return;
      const locale = get().locale;
      set({ busy: true });
      try {
        const existing = get().currentAnnos().length;
        if (existing > 0 && !(await confirmReplaceAnnotations(locale, existing))) return;
        set({ statusMsg: t(locale, "message.preannotatingCurrent") });
        const { annos, skipped } = await runtime.runPreannotation(image.path);
        runtime.applyPreannotation(image.path, annos);
        set({
          statusMsg: appendSkipped(
            locale,
            tt(locale, "message.preannotateCurrentComplete", { count: annos.length }),
            skipped,
          ),
        });
      } catch (error) {
        set({ statusMsg: `${t(locale, "message.preannotateFailed")}: ${String(error)}` });
      } finally {
        set({ busy: false });
      }
    },
    preannotateAll: async (options = {}) => {
      const allImages = [...get().images];
      if (!allImages.length || get().busy || get().batchRunning) return;
      const locale = get().locale;
      const isAnnotated = (image: (typeof allImages)[number]) =>
        image.hasAnnotations === true ||
        image.status !== "pending" ||
        !!get().annotationErrors[image.path];
      const hasExistingAnnotations = allImages.some(isAnnotated);
      const images = options.skipAnnotated
        ? allImages.filter((image) => !isAnnotated(image))
        : allImages;
      if (!images.length) {
        set({ statusMsg: t(locale, "message.noUnannotatedImages") });
        return;
      }
      if (
        hasExistingAnnotations &&
        !options.skipAnnotated &&
        !options.replacementConfirmed
      ) {
        try {
          if (!(await confirmReplaceBatchAnnotations(locale))) return;
        } catch (error) {
          set({
            statusMsg: `${t(locale, "message.preannotateFailed")}: ${String(error)}`,
          });
          return;
        }
      }

      set({
        batchRunning: true,
        batchPhase: "infer",
        batchTotal: images.length,
        batchDone: 0,
        batchFailures: [],
        batchCancelRequested: false,
        batchActivePath: null,
        batchPendingPaths: Object.fromEntries(
          images.map((image) => [image.path, true] as const),
        ),
        statusMsg: tt(locale, "message.batchPreannotatingStart", { total: images.length }),
      });

      const params = runtime.snapshotPreannParams();
      let completed = 0;
      let skippedTotal = 0;
      const failures: string[] = [];
      let started = 0;
      let processed = 0;
      try {
        await mapLimited(
          images,
          INFERENCE_CONCURRENCY,
          async (image) => {
            started += 1;
            set({
              batchActivePath: image.path,
              statusMsg: tt(locale, "message.preannotatingProgressSaving", {
                current: started,
                total: images.length,
                name: image.name,
              }),
            });
            try {
              const { annos, skipped } = await runtime.runPreannotation(image.path, params);
              runtime.applyPreannotation(image.path, annos);
              await runtime.saveImageAfterBatchPreannotation(image.path);
              skippedTotal += skipped;
              completed += 1;
            } catch (error) {
              if (get().batchCancelRequested) return;
              const detail = `${image.name}: ${String(error)}`;
              failures.push(detail);
              set((state) => ({
                batchFailures: [...state.batchFailures, detail],
                annotationErrors: {
                  ...state.annotationErrors,
                  [image.path]: detail,
                },
              }));
            } finally {
              processed += 1;
              set((state) => {
                const batchPendingPaths = { ...state.batchPendingPaths };
                delete batchPendingPaths[image.path];
                return {
                  batchDone: processed,
                  batchActivePath: null,
                  batchPendingPaths,
                };
              });
            }
          },
          () => !get().batchCancelRequested,
        );
        const cancelled = get().batchCancelRequested;
        const message = cancelled
          ? tt(locale, "message.batchPreannotateCancelled", { completed, total: images.length })
          : failures.length
            ? tt(locale, "message.batchPreannotateFinished", {
                completed,
                total: images.length,
                failed: failures.length,
              })
            : tt(locale, "message.batchPreannotateComplete", {
                completed,
                total: images.length,
              });
        if (failures.length) console.error(`Batch pre-annotation failures:\n${failures.join("\n")}`);
        set({ statusMsg: appendSkipped(locale, message, skippedTotal) });
      } finally {
        set({
          batchRunning: false,
          batchPhase: null,
          batchCancelRequested: false,
          batchActivePath: null,
          batchPendingPaths: {},
        });
      }
    },
    requestBatchCancel: () => {
      if (!get().batchRunning) return;
      set({ batchCancelRequested: true });
      void api.cancelPreannotation().catch(() => undefined);
    },
    clearBatchFailures: () => set({ batchFailures: [] }),
    // Explicit Save means the current image has been reviewed and completed.
    // Automatic saves during navigation intentionally keep the existing status.
    save: () => runtime.saveCurrentImage("done"),
    saveAndNext: async () => {
      if (await runtime.saveCurrentImage("done")) {
        void get().selectIndex(get().currentIndex + 1);
      }
    },
  });
