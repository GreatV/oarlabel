import type { StoreApi } from "zustand";
import { modeLabel, t, tt } from "@/i18n";
import { mapLimited } from "@/lib/async";
import {
  parseAnnotationFile,
  type ParsedAnnotationFile,
} from "@/lib/annotationFile";
import {
  api,
  askSaveAndCompleteCurrent,
  confirmDiscardChanges,
} from "@/lib/tauri";
import type {
  Annotation,
  ImageAnnotationFile,
  ImageItem,
  ImageStatus,
  PreannBox,
  PreannResult,
  TextRegionInput,
} from "@/types";
import {
  layoutAnnotation,
  recognizedLayoutAnnotation,
  setAutoFormulaResult,
  setAutoTextResult,
  textAnnotation,
} from "@/store/annotationModel";
import { appendSkipped } from "@/store/messages";
import { STORAGE_KEYS } from "@/store/settingsSlice";
import type { AppState, PreannParams, StoreRuntime } from "@/store/types";
import { saveJson } from "@/lib/storage";

const MAX_HISTORY = 50;
const CLEAN_IMAGE_CACHE_LIMIT = 48;
const LOAD_IPC_CONCURRENCY = 8;
const DIMENSION_UPDATE_BATCH_SIZE = 256;
const DIMENSION_UPDATE_INTERVAL_MS = 100;

type SetState = StoreApi<AppState>["setState"];
type GetState = StoreApi<AppState>["getState"];

export function createStoreRuntime(set: SetState, get: GetState): StoreRuntime {
  let recentImagePaths: string[] = [];
  let loadGeneration = 0;
  let discardConfirmation: Promise<boolean> | null = null;

  const loadImageFile = async (path: string): Promise<ParsedAnnotationFile> =>
    parseAnnotationFile(await api.readAnnotation(path));

  const annotationIssue = (path: string, file: ParsedAnnotationFile): string | null => {
    if (!file.skippedAnnotations) return null;
    const name = path.split(/[\\/]/).pop() ?? path;
    return tt(get().locale, "message.annotationEntriesSkipped", {
      name,
      count: file.skippedAnnotations,
    });
  };

  const recordAnnotationIssues = (path: string, file: ParsedAnnotationFile): string | null => {
    const issue = annotationIssue(path, file);
    set((state) => {
      const annotationErrors = { ...state.annotationErrors };
      if (issue) annotationErrors[path] = issue;
      else delete annotationErrors[path];
      return { annotationErrors };
    });
    return issue;
  };

  const retainRecentCleanImages = (path: string): void => {
    recentImagePaths = [path, ...recentImagePaths.filter((item) => item !== path)].slice(
      0,
      CLEAN_IMAGE_CACHE_LIMIT,
    );
    const keep = new Set(recentImagePaths);
    set((state) => {
      const currentPath = state.currentImage()?.path;
      const annos = { ...state.annos };
      const past = { ...state.past };
      const future = { ...state.future };
      let changed = false;
      for (const cachedPath of Object.keys(annos)) {
        if (cachedPath === currentPath || keep.has(cachedPath) || state.dirtyPaths[cachedPath]) {
          continue;
        }
        delete annos[cachedPath];
        delete past[cachedPath];
        delete future[cachedPath];
        changed = true;
      }
      return changed ? { annos, past, future } : state;
    });
  };

  const snapshotPreannParams = (): PreannParams => {
    const { mode, ocrModel, layoutModel, formulaModel, device, inferenceTuning } = get();
    return {
      mode,
      ocrModel,
      layoutModel,
      formulaModel,
      device,
      thresholds: {
        ocr: inferenceTuning.ocr,
        text_recognition: inferenceTuning.text_recognition,
        layout: inferenceTuning.layout,
      },
    };
  };

  const saveImageFile = async (path: string, status: ImageStatus): Promise<void> => {
    const state = get();
    if (!state.images.some((image) => image.path === path)) return;
    let annotations = state.annos[path];
    const parseError = state.annotationErrors[path];
    if (parseError && !annotations) {
      throw new Error(t(state.locale, "message.annotationUnreadableSave"));
    }
    annotations ??= (await loadImageFile(path)).annotations;
    if (parseError) await api.backupAnnotation(path);
    await api.saveAnnotation(
      path,
      JSON.stringify({ version: 1, status, annotations } satisfies ImageAnnotationFile, null, 2),
    );
  };

  const saveCurrentImage = async (status?: ImageStatus): Promise<boolean> => {
    if (get().busy) return false;
    const image = get().currentImage();
    if (!image) return true;
    if (get().batchPendingPaths[image.path]) return false;
    const locale = get().locale;
    const nextStatus = status ?? image.status;
    set({ busy: true, statusMsg: t(locale, "message.saving") });
    try {
      await saveImageFile(image.path, nextStatus);
      set((state) => {
        const dirtyPaths = { ...state.dirtyPaths };
        const annotationErrors = { ...state.annotationErrors };
        delete dirtyPaths[image.path];
        delete annotationErrors[image.path];
        return {
          dirty: Object.keys(dirtyPaths).length > 0,
          dirtyPaths,
          annotationErrors,
          images: state.images.map((item) =>
            item.path === image.path ? { ...item, status: nextStatus } : item,
          ),
          statusMsg: t(locale, "message.currentImageSaved"),
        };
      });
      return true;
    } catch (error) {
      set({ statusMsg: `${t(locale, "message.saveFailed")}: ${String(error)}` });
      return false;
    } finally {
      set({ busy: false });
    }
  };

  const saveImageAfterBatchPreannotation = async (path: string): Promise<void> => {
    const image = get().images.find((item) => item.path === path);
    if (!image) return;
    await saveImageFile(path, image.status);
    set((state) => {
      const dirtyPaths = { ...state.dirtyPaths };
      const annotationErrors = { ...state.annotationErrors };
      const annos = { ...state.annos };
      const past = { ...state.past };
      const future = { ...state.future };
      delete dirtyPaths[path];
      delete annotationErrors[path];
      if (state.currentImage()?.path !== path) {
        delete annos[path];
        delete past[path];
        delete future[path];
      }
      return {
        annos,
        past,
        future,
        dirty: Object.keys(dirtyPaths).length > 0,
        dirtyPaths,
        annotationErrors,
      };
    });
  };

  const prepareCurrentImageForSwitch = async (targetIndex: number): Promise<boolean> => {
    if (targetIndex === get().currentIndex) return true;
    const state = get();
    const image = state.currentImage();
    if (state.autoSave) {
      return image && state.dirtyPaths[image.path] ? saveCurrentImage() : true;
    }
    if (!image || image.status === "done" || !state.dirtyPaths[image.path]) return true;
    set({ busy: true });
    let shouldSave: boolean;
    try {
      shouldSave = await askSaveAndCompleteCurrent(get().locale);
    } catch (error) {
      set({ statusMsg: `${t(get().locale, "message.saveFailed")}: ${String(error)}` });
      return false;
    } finally {
      set({ busy: false });
    }
    return shouldSave ? saveCurrentImage("done") : true;
  };

  const annotationFileForExport = async (path: string): Promise<ParsedAnnotationFile> => {
    const annotations = get().annos[path];
    if (!annotations) {
      const file = await loadImageFile(path);
      recordAnnotationIssues(path, file);
      return file;
    }
    return {
      version: 1,
      status: get().images.find((image) => image.path === path)?.status ?? "pending",
      annotations,
      skippedAnnotations: 0,
      invalidAnnotationIndices: [],
    };
  };

  const mutate = (
    producer: (previous: Annotation[]) => Annotation[],
    options: { allowDuringBusy?: boolean; preserveStatus?: boolean } = {},
  ): boolean => {
    if (get().busy && !options.allowDuringBusy) return false;
    const image = get().currentImage();
    if (!image) return false;
    const path = image.path;
    if (get().batchPendingPaths[path]) return false;
    set((state) => {
      const previous = state.annos[path] ?? [];
      const annotations = producer(previous);
      const currentStatus =
        state.images.find((item) => item.path === path)?.status ?? image.status;
      return {
        annos: { ...state.annos, [path]: annotations },
        past: {
          ...state.past,
          [path]: (state.past[path] ?? [])
            .concat({
              annotations: previous,
              status: currentStatus,
              dirty: state.dirtyPaths[path] === true,
            })
            .slice(-MAX_HISTORY),
        },
        future: { ...state.future, [path]: [] },
        images: state.images.map((item) =>
          item.path === path
            ? {
                ...item,
                status: options.preserveStatus
                  ? currentStatus
                  : ("labeling" as ImageStatus),
              }
            : item,
        ),
        dirty: true,
        dirtyPaths: { ...state.dirtyPaths, [path]: true },
      };
    });
    return true;
  };

  const recognizeTextForAnnotations = async (annotations: Annotation[]): Promise<void> => {
    if (get().busy || get().batchRunning) return;
    const image = get().currentImage();
    const locale = get().locale;
    if (!image) return;
    if (!annotations.length) {
      set({ statusMsg: t(locale, "message.recognizeTextNoBoxes") });
      return;
    }
    const regions: TextRegionInput[] = annotations.map(({ id, points }) => ({ id, points }));
    set({ busy: true, statusMsg: t(locale, "message.recognizingText") });
    try {
      const result = await api.recognizeTextRegions(
        image.path,
        get().ocrModel,
        get().device,
        regions,
        { text_recognition: get().inferenceTuning.text_recognition },
      );
      if (result.regions.length) {
        const recognized = new Map(result.regions.map((region) => [region.id, region]));
        mutate(
          (previous) =>
            previous.map((annotation) => {
              const region = recognized.get(annotation.id);
              return region
                ? setAutoTextResult(annotation, region.text, region.score)
                : annotation;
            }),
          { allowDuringBusy: true },
        );
      }
      set({
        statusMsg: appendSkipped(
          locale,
          tt(locale, "message.recognizeTextComplete", { count: result.regions.length }),
          result.skipped,
        ),
      });
    } catch (error) {
      set({ statusMsg: `${t(locale, "message.recognizeTextFailed")}: ${String(error)}` });
    } finally {
      set({ busy: false });
    }
  };

  const recognizeFormulaForAnnotations = async (annotations: Annotation[]): Promise<void> => {
    if (get().busy || get().batchRunning) return;
    const image = get().currentImage();
    const locale = get().locale;
    if (!image) return;
    if (!annotations.length) {
      set({ statusMsg: t(locale, "message.recognizeFormulaNoBoxes") });
      return;
    }
    const regions: TextRegionInput[] = annotations.map(({ id, points }) => ({ id, points }));
    set({ busy: true, statusMsg: t(locale, "message.recognizingFormula") });
    try {
      const result = await api.recognizeFormulaRegions(
        image.path,
        get().formulaModel,
        get().device,
        regions,
      );
      if (result.regions.length) {
        const recognized = new Map(result.regions.map((region) => [region.id, region]));
        mutate(
          (previous) =>
            previous.map((annotation) => {
              const region = recognized.get(annotation.id);
              return region
                ? setAutoFormulaResult(annotation, region.text, region.score)
                : annotation;
            }),
          { allowDuringBusy: true },
        );
      }
      set({
        statusMsg: appendSkipped(
          locale,
          tt(locale, "message.recognizeFormulaComplete", { count: result.regions.length }),
          result.skipped,
        ),
      });
    } catch (error) {
      set({ statusMsg: `${t(locale, "message.recognizeFormulaFailed")}: ${String(error)}` });
    } finally {
      set({ busy: false });
    }
  };

  const runPreannotation = async (
    path: string,
    params: PreannParams = snapshotPreannParams(),
  ): Promise<{ annos: Annotation[]; skipped: number }> => {
    const { mode, ocrModel, layoutModel, formulaModel, device, thresholds } = params;
    const locale = get().locale;
    const result: PreannResult = await api.preannotate(
      path,
      mode,
      ocrModel,
      layoutModel,
      formulaModel,
      device,
      thresholds,
    );
    let missingOcrText = 0;
    const annos = result.boxes.map((box: PreannBox) => {
      if (mode === "layout") return layoutAnnotation(box.points, box.label ?? "region", box.score);
      if (mode === "formula") {
        if (box.text == null) {
          throw new Error(
            tt(locale, "message.resultMissingText", { mode: modeLabel(locale, mode) }),
          );
        }
        return recognizedLayoutAnnotation(
          box.points,
          box.label ?? "formula",
          box.text,
          box.score,
        );
      }
      if (box.text == null) missingOcrText += 1;
      return textAnnotation(box.points, box.text ?? "", box.score);
    });
    return { annos, skipped: result.skipped + missingOcrText };
  };

  const applyPreannotation = (path: string, annotations: Annotation[]): void => {
    set((state) => {
      const isCurrent = state.currentImage()?.path === path;
      const status = state.images.find((image) => image.path === path)?.status ?? "pending";
      return {
        annos: { ...state.annos, [path]: annotations },
        past: {
          ...state.past,
          [path]: (state.past[path] ?? [])
            .concat({
              annotations: state.annos[path] ?? [],
              status,
              dirty: state.dirtyPaths[path] === true,
            })
            .slice(-MAX_HISTORY),
        },
        future: { ...state.future, [path]: [] },
        images: state.images.map((image) =>
          image.path === path ? { ...image, status: "preannotated" as ImageStatus } : image,
        ),
        dirty: true,
        dirtyPaths: { ...state.dirtyPaths, [path]: true },
        ...(isCurrent ? { selectedIds: [], selectedId: null } : {}),
      };
    });
  };

  const loadImageDimensions = async (images: ImageItem[], token: number): Promise<void> => {
    let pending = new Map<string, { width: number; height: number }>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pending.size || token !== loadGeneration) {
        pending.clear();
        return;
      }
      const updates = pending;
      pending = new Map();
      set((state) => ({
        images: state.images.map((image) => {
          const size = updates.get(image.path);
          return size ? { ...image, ...size } : image;
        }),
      }));
    };
    const scheduleFlush = () => {
      if (pending.size >= DIMENSION_UPDATE_BATCH_SIZE) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, DIMENSION_UPDATE_INTERVAL_MS);
      }
    };
    await mapLimited(
      images,
      LOAD_IPC_CONCURRENCY,
      async (image) => {
        try {
          const [width, height] = await api.imageSize(image.path);
          if (token !== loadGeneration) return;
          pending.set(image.path, { width, height });
          scheduleFlush();
        } catch {
          // Image remains usable even when dimensions cannot be read eagerly.
        }
      },
      () => token === loadGeneration,
    );
    flush();
  };

  const loadImageList = async (
    raw: Omit<ImageItem, "status">[],
    dir: string | null,
    label: string,
    token: number,
  ): Promise<void> => {
    const firstPath = raw[0]?.path;
    recentImagePaths = firstPath ? [firstPath] : [];
    const resolved = (
      await mapLimited(
        raw,
        LOAD_IPC_CONCURRENCY,
        async (item) => {
          try {
            const file = await loadImageFile(item.path);
            return {
              image: { ...item, status: file.status },
              firstFile: item.path === firstPath ? file : null,
              firstError: null,
              issue: annotationIssue(item.path, file),
            };
          } catch (error) {
            return {
              image: { ...item, status: "pending" as ImageStatus },
              firstFile: null,
              firstError: item.path === firstPath ? String(error) : null,
              issue: null,
            };
          }
        },
        () => token === loadGeneration,
      )
    ).filter((item) => item != null);
    if (token !== loadGeneration) return;
    const images = resolved.map((item) => item.image);
    const first = resolved.find((item) => item.image.path === firstPath);
    const annotationErrors = Object.fromEntries(
      resolved
        .filter((item) => item.issue)
        .map((item) => [item.image.path, item.issue as string]),
    );
    if (first?.firstError && firstPath) annotationErrors[firstPath] = first.firstError;
    const locale = get().locale;
    set({
      dir,
      images,
      annos: first?.firstFile && firstPath ? { [firstPath]: first.firstFile.annotations } : {},
      annotationErrors,
      currentIndex: images.length ? 0 : -1,
      selectedIds: [],
      selectedId: null,
      past: {},
      future: {},
      dirty: false,
      dirtyPaths: {},
      statusMsg: first?.firstError
        ? `${label}${locale === "zh-CN" ? "；" : "; "}${t(locale, "message.readAnnotationFailed")}: ${first.firstError}`
        : first?.issue
          ? `${label}${locale === "zh-CN" ? "；" : "; "}${first.issue}`
          : label,
    });
    void loadImageDimensions(images, token);
  };

  return {
    beginLoad: () => ++loadGeneration,
    isCurrentLoad: (token) => token === loadGeneration,
    canDiscardDirty: async () => {
      if (!get().dirty) return true;
      const confirmation =
        discardConfirmation ?? confirmDiscardChanges(get().locale);
      discardConfirmation = confirmation;
      try {
        return await confirmation;
      } finally {
        if (discardConfirmation === confirmation) discardConfirmation = null;
      }
    },
    loadImageList,
    pushRecent: (dir) => {
      const recentDirs = [dir, ...get().recentDirs.filter((item) => item !== dir)].slice(0, 8);
      set({ recentDirs });
      saveJson(STORAGE_KEYS.recentDirs, recentDirs);
    },
    prepareCurrentImageForSwitch,
    loadImageFile,
    recordAnnotationIssues,
    retainRecentCleanImages,
    mutate,
    recognizeTextForAnnotations,
    recognizeFormulaForAnnotations,
    snapshotPreannParams,
    runPreannotation,
    applyPreannotation,
    saveImageAfterBatchPreannotation,
    saveCurrentImage,
    annotationFileForExport,
  };
}
