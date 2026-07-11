import type { StateCreator } from "zustand";
import { t, tt } from "@/i18n";
import { api } from "@/lib/tauri";
import type { Annotation } from "@/types";
import type { AppState, StoreRuntime, WorkspaceSlice } from "@/store/types";

const EMPTY_ANNOTATIONS: Annotation[] = [];

export const createWorkspaceSlice = (
  runtime: StoreRuntime,
): StateCreator<AppState, [], [], WorkspaceSlice> =>
  (set, get) => ({
    dir: null,
    images: [],
    currentIndex: -1,
    annotationErrors: {},
    busy: false,
    statusMsg: "",
    dirty: false,
    dirtyPaths: {},
    currentImage: () => {
      const { images, currentIndex } = get();
      return currentIndex >= 0 && currentIndex < images.length ? images[currentIndex] : null;
    },
    currentAnnos: () => {
      const image = get().currentImage();
      return image ? get().annos[image.path] ?? EMPTY_ANNOTATIONS : EMPTY_ANNOTATIONS;
    },
    openFolder: async (dir) => {
      if (get().busy || get().batchRunning) return;
      const token = runtime.beginLoad();
      if (!(await runtime.canDiscardDirty()) || !runtime.isCurrentLoad(token)) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.loadingFolder") });
      try {
        const raw = await api.listImages(dir);
        if (!runtime.isCurrentLoad(token)) return;
        await runtime.loadImageList(
          raw,
          dir,
          tt(locale, "message.loadedImages", { count: raw.length }),
          token,
        );
        if (!runtime.isCurrentLoad(token)) return;
        runtime.pushRecent(dir);
        if (!raw.length) set({ statusMsg: t(locale, "message.noImagesFound") });
      } catch (error) {
        if (runtime.isCurrentLoad(token)) {
          set({ statusMsg: `${t(locale, "message.loadFailed")}: ${String(error)}` });
        }
      } finally {
        if (runtime.isCurrentLoad(token)) set({ busy: false });
      }
    },
    openFiles: async (paths) => {
      if (!paths.length || get().busy || get().batchRunning) return;
      const token = runtime.beginLoad();
      if (!(await runtime.canDiscardDirty()) || !runtime.isCurrentLoad(token)) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.loadingImages") });
      try {
        const raw = await api.imageItems(paths);
        if (runtime.isCurrentLoad(token)) {
          await runtime.loadImageList(
            raw,
            null,
            tt(locale, "message.loadedImages", { count: raw.length }),
            token,
          );
        }
      } catch (error) {
        if (runtime.isCurrentLoad(token)) {
          set({ statusMsg: `${t(locale, "message.loadFailed")}: ${String(error)}` });
        }
      } finally {
        if (runtime.isCurrentLoad(token)) set({ busy: false });
      }
    },
    selectIndex: async (index) => {
      if (get().busy) return;
      const { images } = get();
      if (index < 0 || index >= images.length) return;
      if (get().batchPendingPaths[images[index].path]) {
        set({ statusMsg: t(get().locale, "message.batchImageLocked") });
        return;
      }
      if (!(await runtime.prepareCurrentImageForSwitch(index))) return;
      const image = images[index];
      set({ currentIndex: index, selectedIds: [], selectedId: null });
      if (get().annos[image.path]) {
        runtime.retainRecentCleanImages(image.path);
        return;
      }
      try {
        const file = await runtime.loadImageFile(image.path);
        const issue = runtime.recordAnnotationIssues(image.path, file);
        set((state) => {
          const annotationErrors = { ...state.annotationErrors };
          if (issue) annotationErrors[image.path] = issue;
          else delete annotationErrors[image.path];
          return {
            annos: { ...state.annos, [image.path]: file.annotations },
            annotationErrors,
            images: state.images.map((item) =>
              item.path === image.path ? { ...item, status: file.status } : item,
            ),
            ...(issue ? { statusMsg: issue } : {}),
          };
        });
      } catch (error) {
        set((state) => ({
          annotationErrors: { ...state.annotationErrors, [image.path]: String(error) },
          statusMsg: `${t(state.locale, "message.readAnnotationFailed")}: ${String(error)}`,
        }));
      }
      runtime.retainRecentCleanImages(image.path);
    },
    next: () => void get().selectIndex(get().currentIndex + 1),
    prev: () => void get().selectIndex(get().currentIndex - 1),
  });
