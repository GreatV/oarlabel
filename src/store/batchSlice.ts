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

const LOAD_IPC_CONCURRENCY = 8;

export const createBatchSlice = (
  runtime: StoreRuntime,
): StateCreator<AppState, [], [], BatchSlice> =>
  (set, get) => ({
    batchRunning: false,
    batchTotal: 0,
    batchDone: 0,
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
    preannotateAll: async () => {
      const images = [...get().images];
      if (!images.length || get().busy || get().batchRunning) return;
      const locale = get().locale;
      set({
        batchRunning: true,
        batchTotal: images.length,
        batchDone: 0,
        batchCancelRequested: false,
        batchActivePath: null,
        batchPendingPaths: Object.fromEntries(
          images.map((image) => [image.path, true] as const),
        ),
        statusMsg: t(locale, "message.inspectingAnnotations"),
      });

      let annotatedImageCount = 0;
      let annotationCount = 0;
      const damagedSidecars: string[] = [];
      try {
        let inspectedCount = 0;
        const inspected = await mapLimited(
          images,
          LOAD_IPC_CONCURRENCY,
          async (image) => {
            try {
              const count = await runtime.annotationCountForPath(image.path);
              inspectedCount += 1;
              set({
                batchDone: inspectedCount,
                statusMsg: tt(locale, "message.inspectingAnnotationsProgress", {
                  current: inspectedCount,
                  total: images.length,
                  name: image.name,
                }),
              });
              return { count, damaged: null };
            } catch (error) {
              const detail = `${image.name}: ${String(error)}`;
              damagedSidecars.push(detail);
              set((state) => ({
                annotationErrors: {
                  ...state.annotationErrors,
                  [image.path]: detail,
                },
              }));
              // The content is unknown, but the sidecar exists and will be
              // replaced. Count one sentinel annotation so confirmation is
              // never skipped for a destructive recovery.
              return { count: 1, damaged: detail };
            }
          },
          () => !get().batchCancelRequested,
        );
        for (const item of inspected) {
          if (!item || item.count <= 0) continue;
          annotatedImageCount += 1;
          annotationCount += item.count;
        }
        if (damagedSidecars.length) {
          console.warn(`Unreadable sidecars scheduled for replacement:\n${damagedSidecars.join("\n")}`);
        }
      } catch (error) {
        set({
          batchRunning: false,
          batchCancelRequested: false,
          batchActivePath: null,
          batchPendingPaths: {},
          statusMsg: `${t(get().locale, "message.inspectAnnotationsFailed")}: ${String(error)}`,
        });
        return;
      }

      if (get().batchCancelRequested) {
        set({
          batchRunning: false,
          batchCancelRequested: false,
          batchActivePath: null,
          batchPendingPaths: {},
          statusMsg: tt(locale, "message.batchPreannotateCancelled", {
            completed: 0,
            total: images.length,
          }),
        });
        return;
      }

      if (annotationCount > 0) {
        try {
          const replace = await confirmReplaceBatchAnnotations(
            get().locale,
            images.length,
            annotatedImageCount,
            annotationCount,
            damagedSidecars.length,
          );
          if (!replace) {
            set({
              batchRunning: false,
              batchCancelRequested: false,
              batchActivePath: null,
              batchPendingPaths: {},
            });
            return;
          }
        } catch (error) {
          set({
            batchRunning: false,
            batchCancelRequested: false,
            batchActivePath: null,
            batchPendingPaths: {},
            statusMsg: `${t(get().locale, "message.preannotateFailed")}: ${String(error)}`,
          });
          return;
        }
      }

      const params = runtime.snapshotPreannParams();
      set({
        batchDone: 0,
        statusMsg: tt(locale, "message.batchPreannotatingStart", { total: images.length }),
      });
      let completed = 0;
      let skippedTotal = 0;
      const failures: string[] = [];
      let cancelled = false;
      try {
        for (let index = 0; index < images.length; index += 1) {
          if (get().batchCancelRequested) {
            cancelled = true;
            break;
          }
          const image = images[index];
          set({
            batchDone: index,
            batchActivePath: image.path,
            statusMsg: tt(locale, "message.preannotatingProgressSaving", {
              current: index + 1,
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
            if (get().batchCancelRequested) {
              cancelled = true;
              break;
            }
            const detail = `${image.name}: ${String(error)}`;
            failures.push(detail);
            set((state) => ({
              annotationErrors: {
                ...state.annotationErrors,
                [image.path]: detail,
              },
            }));
          } finally {
            set((state) => {
              const batchPendingPaths = { ...state.batchPendingPaths };
              delete batchPendingPaths[image.path];
              return {
                batchDone: index + 1,
                batchActivePath: null,
                batchPendingPaths,
              };
            });
          }
        }
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
    // Explicit Save means the current image has been reviewed and completed.
    // Automatic saves during navigation intentionally keep the existing status.
    save: () => runtime.saveCurrentImage("done"),
    saveAndNext: async () => {
      if (await runtime.saveCurrentImage("done")) {
        void get().selectIndex(get().currentIndex + 1);
      }
    },
  });
