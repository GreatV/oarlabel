// Central application state (zustand).

import { create } from "zustand";
import type {
  Annotation,
  AnnotationResult,
  Device,
  FitMode,
  ImageAnnotationFile,
  ImageItem,
  ImageStatus,
  Mode,
  ModelOptions,
  ModelStatus,
  Point,
  PreannBox,
  Tool,
  ViewOptions,
} from "@/types";
import { t, tt, type Locale } from "@/i18n";
import { resultText } from "@/types";
import {
  api,
  confirmDiscardChanges,
  confirmReplaceAnnotations,
  confirmReplaceBatchAnnotations,
} from "@/lib/tauri";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---- lightweight localStorage persistence ----
const LS = {
  view: "oarlabel.view",
  ocrModel: "oarlabel.ocrModel",
  layoutModel: "oarlabel.layoutModel",
  formulaModel: "oarlabel.formulaModel",
  tableModel: "oarlabel.tableModel",
  device: "oarlabel.device",
  locale: "oarlabel.locale",
  recentDirs: "oarlabel.recentDirs",
} as const;

function loadLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const DEFAULT_VIEW: ViewOptions = {
  fileList: true,
  results: true,
  toolbar: true,
  statusBar: true,
  boxes: true,
  labels: true,
  highlight: true,
};

const EMPTY_ANNOTATIONS: Annotation[] = [];

const MAX_RECENT = 8;

function cloneAnno(a: Annotation): Annotation {
  return {
    id: a.id,
    points: a.points.map((p) => [p[0], p[1]] as Point),
    results: a.results.map((r) => ({ ...r, value: { ...r.value } })),
  };
}

interface AppState {
  dir: string | null;
  images: ImageItem[];
  currentIndex: number;
  annos: Record<string, Annotation[]>;
  selectedIds: string[];
  selectedId: string | null; // primary (last) selection, derived from selectedIds
  clipboard: Annotation[];
  mode: Mode;
  tool: Tool;
  zoom: number;
  busy: boolean;
  statusMsg: string;
  dirty: boolean;
  dirtyPaths: Record<string, boolean>;
  models: ModelStatus[];
  modelOptions: ModelOptions | null;

  // view + model/device selection
  view: ViewOptions;
  ocrModel: string;
  layoutModel: string;
  formulaModel: string;
  tableModel: string;
  device: Device;
  locale: Locale;
  recentDirs: string[];

  // canvas fit request (CanvasStage watches fitNonce)
  fitMode: FitMode | null;
  fitNonce: number;

  // history (per image path)
  past: Record<string, Annotation[][]>;
  future: Record<string, Annotation[][]>;

  // selectors
  currentImage: () => ImageItem | null;
  currentAnnos: () => Annotation[];

  // actions
  openFolder: (dir: string) => Promise<void>;
  openFiles: (paths: string[]) => Promise<void>;
  openPdf: (pdfPath: string) => Promise<void>;
  selectIndex: (i: number) => Promise<void>;
  next: () => void;
  prev: () => void;
  setMode: (m: Mode) => void;
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  requestFit: (mode: FitMode) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;

  addAnnotation: (points: Point[], label?: string) => void;
  updateAnnotationPoints: (id: string, points: Point[]) => void;
  setText: (id: string, text: string) => void;
  removeAnnotation: (id: string) => void;
  removeSelected: () => void;
  copySelection: () => void;
  paste: () => void;

  undo: () => void;
  redo: () => void;

  // view + model
  toggleView: (key: keyof ViewOptions) => void;
  resetLayout: () => void;
  setOcrModel: (key: string) => void;
  setLayoutModel: (key: string) => void;
  setFormulaModel: (key: string) => void;
  setTableModel: (key: string) => void;
  setDevice: (device: Device) => void;
  setLocale: (locale: Locale) => void;

  preannotateCurrent: () => Promise<void>;
  preannotateAll: () => Promise<void>;
  save: () => Promise<void>;
  exportableImages: () => Promise<
    { path: string; boxes: { points: Point[]; transcription: string }[] }[]
  >;

  refreshModels: () => Promise<void>;
}

const MAX_HISTORY = 50;

function emptyAnnotationFile(): ImageAnnotationFile {
  return { version: 1, status: "pending", annotations: [] };
}

function parseAnnotationFile(text: string | null): ImageAnnotationFile {
  if (!text) return emptyAnnotationFile();
  const parsed = JSON.parse(text) as Partial<ImageAnnotationFile>;
  return {
    version: 1,
    status: parsed.status ?? "pending",
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
  };
}

function currentLabel(mode: Mode, explicit?: string): string {
  if (explicit) return explicit;
  if (mode === "table") return "table";
  if (mode === "formula") return "formula";
  if (mode === "layout") return "layout";
  return "text";
}

function manualResults(label: string): AnnotationResult[] {
  if (label === "text") {
    return [
      {
        task: "text_detection",
        value: { label: "text" },
        score: 1,
        source: "manual",
      },
      {
        task: "text_recognition",
        value: { text: "" },
        score: 1,
        source: "manual",
      },
    ];
  }
  return [
    {
      task: "layout_detection",
      value: { label },
      score: 1,
      source: "manual",
    },
  ];
}

function setTextResult(a: Annotation, text: string): Annotation {
  let found = false;
  const results = a.results.map((r) => {
    if (r.task !== "text_recognition") return r;
    found = true;
    return {
      ...r,
      value: { ...r.value, text },
      score: 1,
      source: "manual" as const,
    };
  });
  if (found) return { ...a, results };
  return {
    ...a,
    results: results.concat({
      task: "text_recognition",
      value: { text },
      score: 1,
      source: "manual",
    }),
  };
}

function textAnnotation(points: Point[], text: string, score: number | null): Annotation {
  return {
    id: uid(),
    points,
    results: [
      {
        task: "text_detection",
        value: { label: "text" },
        score,
        source: "auto",
      },
      {
        task: "text_recognition",
        value: { text },
        score,
        source: "auto",
      },
    ],
  };
}

function layoutAnnotation(points: Point[], label: string, score: number | null): Annotation {
  return {
    id: uid(),
    points,
    results: [
      {
        task: "layout_detection",
        value: { label },
        score,
        source: "auto",
      },
    ],
  };
}

function recognizedLayoutAnnotation(
  points: Point[],
  label: string,
  text: string,
  score: number | null,
): Annotation {
  return {
    id: uid(),
    points,
    results: [
      {
        task: "layout_detection",
        value: { label },
        score,
        source: "auto",
      },
      {
        task: "text_recognition",
        value: { text },
        score,
        source: "auto",
      },
    ],
  };
}

export const useStore = create<AppState>((set, get) => {
  async function loadImageFile(path: string): Promise<ImageAnnotationFile> {
    return parseAnnotationFile(await api.readAnnotation(path));
  }

  async function saveImageFile(path: string): Promise<void> {
    const state = get();
    const img = state.images.find((it) => it.path === path);
    if (!img) return;
    let annotations = state.annos[path];
    if (!annotations) {
      annotations = (await loadImageFile(path)).annotations;
    }
    const data: ImageAnnotationFile = {
      version: 1,
      status: img.status,
      annotations,
    };
    await api.saveAnnotation(path, JSON.stringify(data, null, 2));
  }

  async function canDiscardDirty(): Promise<boolean> {
    return !get().dirty || confirmDiscardChanges();
  }

  async function annotationFileForExport(path: string): Promise<ImageAnnotationFile> {
    const annotations = get().annos[path];
    if (annotations) {
      const img = get().images.find((it) => it.path === path);
      return {
        version: 1,
        status: img?.status ?? "pending",
        annotations,
      };
    }
    return loadImageFile(path);
  }

  async function annotationsForPath(path: string): Promise<Annotation[]> {
    const loaded = get().annos[path];
    if (loaded) return loaded;
    const file = await loadImageFile(path);
    set((s) => ({ annos: { ...s.annos, [path]: file.annotations } }));
    return file.annotations;
  }

  async function runPreannotation(path: string): Promise<Annotation[]> {
    const { mode, ocrModel, layoutModel, formulaModel, tableModel, device } = get();
    const boxes: PreannBox[] = await api.preannotate(
      path,
      mode,
      ocrModel,
      layoutModel,
      formulaModel,
      tableModel,
      device,
    );
    return boxes.map((b) => {
      if (mode === "ocr" || mode === "reading") {
        if (b.text == null) throw new Error(t(get().locale, "message.ocrMissingText"));
        return textAnnotation(b.points, b.text, b.score);
      }
      if (b.label == null) throw new Error(tt(get().locale, "message.resultMissingLabel", { mode }));
      if (mode === "formula" || mode === "table") {
        if (b.text == null) throw new Error(tt(get().locale, "message.resultMissingText", { mode }));
        return recognizedLayoutAnnotation(b.points, b.label, b.text, b.score);
      }
      return layoutAnnotation(b.points, b.label, b.score);
    });
  }

  function applyPreannotation(path: string, annos: Annotation[]): void {
    set((s) => ({
      annos: { ...s.annos, [path]: annos },
      past: {
        ...s.past,
        [path]: (s.past[path] ?? []).concat([s.annos[path] ?? []]).slice(-MAX_HISTORY),
      },
      future: { ...s.future, [path]: [] },
      images: s.images.map((it) =>
        it.path === path && it.status === "pending"
          ? { ...it, status: "preannotated" as ImageStatus }
          : it,
      ),
      dirty: true,
      dirtyPaths: { ...s.dirtyPaths, [path]: true },
    }));
  }

  /** Shared loader for a freshly-resolved image list (folder / files / pdf). */
  async function loadImageList(
    raw: Omit<ImageItem, "status">[],
    dir: string | null,
    label: string,
  ): Promise<void> {
    const images: ImageItem[] = await Promise.all(
      raw.map(async (r) => {
        try {
          const file = await loadImageFile(r.path);
          return { ...r, status: file.status };
        } catch {
          return { ...r, status: "pending" as ImageStatus };
        }
      }),
    );
    set({
      dir,
      images,
      annos: {},
      currentIndex: images.length ? 0 : -1,
      selectedIds: [],
      selectedId: null,
      past: {},
      future: {},
      dirty: false,
      dirtyPaths: {},
      statusMsg: label,
    });
    if (images[0]) {
      const file = await loadImageFile(images[0].path);
      set((s) => ({
        annos: { ...s.annos, [images[0].path]: file.annotations },
        images: s.images.map((it) =>
          it.path === images[0].path ? { ...it, status: file.status } : it,
        ),
      }));
    }
    // lazily fill in dimensions
    for (let i = 0; i < images.length; i++) {
      api
        .imageSize(images[i].path)
        .then(([w, h]) =>
          set((s) => ({
            images: s.images.map((it) =>
              it.path === images[i].path ? { ...it, width: w, height: h } : it,
            ),
          })),
        )
        .catch(() => {});
    }
  }

  function pushRecent(dir: string): void {
    const next = [dir, ...get().recentDirs.filter((d) => d !== dir)].slice(0, MAX_RECENT);
    set({ recentDirs: next });
    saveLS(LS.recentDirs, next);
  }

  /** Mutate the current image's annotations with undo bookkeeping. */
  function mutate(producer: (prev: Annotation[]) => Annotation[]) {
    const img = get().currentImage();
    if (!img) return;
    const path = img.path;
    set((s) => {
      const prev = s.annos[path] ?? [];
      const nextArr = producer(prev);
      const past = (s.past[path] ?? []).concat([prev]).slice(-MAX_HISTORY);
      const images = s.images.map((it) =>
        it.path === path && it.status !== "done"
          ? { ...it, status: "labeling" as ImageStatus }
          : it,
      );
      return {
        annos: { ...s.annos, [path]: nextArr },
        past: { ...s.past, [path]: past },
        future: { ...s.future, [path]: [] },
        images,
        dirty: true,
        dirtyPaths: { ...s.dirtyPaths, [path]: true },
      };
    });
  }

  return {
    dir: null,
    images: [],
    currentIndex: -1,
    annos: {},
    selectedIds: [],
    selectedId: null,
    clipboard: [],
    mode: "ocr",
    tool: "select",
    zoom: 1,
    busy: false,
    statusMsg: "",
    dirty: false,
    dirtyPaths: {},
    models: [],
    modelOptions: null,

    view: loadLS<ViewOptions>(LS.view, DEFAULT_VIEW),
    ocrModel: loadLS<string>(LS.ocrModel, "ppocrv6_tiny"),
    layoutModel: loadLS<string>(LS.layoutModel, "layout_doc_v3"),
    formulaModel: loadLS<string>(LS.formulaModel, "pp_formulanet_plus_s"),
    tableModel: loadLS<string>(LS.tableModel, "slanet_plus"),
    device: loadLS<Device>(LS.device, "auto"),
    locale: loadLS<Locale>(LS.locale, "zh-CN"),
    recentDirs: loadLS<string[]>(LS.recentDirs, []),

    fitMode: null,
    fitNonce: 0,

    past: {},
    future: {},

    currentImage: () => {
      const { images, currentIndex } = get();
      return currentIndex >= 0 && currentIndex < images.length
        ? images[currentIndex]
        : null;
    },
    currentAnnos: () => {
      const img = get().currentImage();
      return img ? (get().annos[img.path] ?? EMPTY_ANNOTATIONS) : EMPTY_ANNOTATIONS;
    },

    openFolder: async (dir) => {
      if (!(await canDiscardDirty())) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.loadingFolder") });
      try {
        console.info("opening image folder", dir);
        const raw = await api.listImages(dir);
        console.info("loaded image folder", { dir, count: raw.length });
        await loadImageList(raw, dir, tt(locale, "message.loadedImages", { count: raw.length }));
        pushRecent(dir);
        if (raw.length === 0) {
          set({ statusMsg: t(locale, "message.noImagesFound") });
        }
      } catch (e) {
        console.error("load image folder failed", e);
        set({ statusMsg: `${t(locale, "message.loadFailed")}: ${String(e)}` });
      } finally {
        set({ busy: false });
      }
    },

    openFiles: async (paths) => {
      if (!paths.length) return;
      if (!(await canDiscardDirty())) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.loadingImages") });
      try {
        const raw = await api.imageItems(paths);
        await loadImageList(raw, null, tt(locale, "message.loadedImages", { count: raw.length }));
      } catch (e) {
        set({ statusMsg: `${t(locale, "message.loadFailed")}: ${String(e)}` });
      } finally {
        set({ busy: false });
      }
    },

    openPdf: async (pdfPath) => {
      if (!(await canDiscardDirty())) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.renderingPdf") });
      try {
        const raw = await api.importPdf(pdfPath);
        await loadImageList(raw, null, tt(locale, "message.pdfImported", { count: raw.length }));
      } catch (e) {
        set({ statusMsg: `${t(locale, "message.pdfImportFailed")}: ${String(e)}` });
      } finally {
        set({ busy: false });
      }
    },

    selectIndex: async (i) => {
      const { images } = get();
      if (i < 0 || i >= images.length) return;
      const img = images[i];
      set({ currentIndex: i, selectedIds: [], selectedId: null });
      if (get().annos[img.path]) return;
      try {
        const file = await loadImageFile(img.path);
        set((s) => ({
          annos: { ...s.annos, [img.path]: file.annotations },
          images: s.images.map((it) =>
            it.path === img.path ? { ...it, status: file.status } : it,
          ),
        }));
      } catch (e) {
        set({ statusMsg: `${t(get().locale, "message.readAnnotationFailed")}: ${String(e)}` });
      }
    },
    next: () => {
      void get().selectIndex(get().currentIndex + 1);
    },
    prev: () => {
      void get().selectIndex(get().currentIndex - 1);
    },

    setMode: (mode) => set({ mode, selectedIds: [], selectedId: null }),
    setTool: (tool) => set({ tool }),
    setZoom: (zoom) => set({ zoom: Math.min(8, Math.max(0.1, zoom)) }),
    requestFit: (mode) => set((s) => ({ fitMode: mode, fitNonce: s.fitNonce + 1 })),

    select: (id, additive = false) => {
      if (id === null) {
        set({ selectedIds: [], selectedId: null });
        return;
      }
      if (!additive) {
        set({ selectedIds: [id], selectedId: id });
        return;
      }
      set((s) => {
        const has = s.selectedIds.includes(id);
        const ids = has
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id];
        return { selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null };
      });
    },
    selectAll: () => {
      const ids = get().currentAnnos().map((a) => a.id);
      set({ selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null });
    },
    clearSelection: () => set({ selectedIds: [], selectedId: null }),

    addAnnotation: (points, label) => {
      const id = uid();
      const resultLabel = currentLabel(get().mode, label);
      mutate((prev) =>
        prev.concat({ id, points, results: manualResults(resultLabel) }),
      );
      set({ selectedIds: [id], selectedId: id });
    },
    updateAnnotationPoints: (id, points) =>
      mutate((prev) => prev.map((a) => (a.id === id ? { ...a, points } : a))),
    setText: (id, text) =>
      mutate((prev) => prev.map((a) => (a.id === id ? setTextResult(a, text) : a))),
    removeAnnotation: (id) => {
      mutate((prev) => prev.filter((a) => a.id !== id));
      set((s) => {
        const ids = s.selectedIds.filter((x) => x !== id);
        return { selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null };
      });
    },
    removeSelected: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      mutate((prev) => prev.filter((a) => !ids.has(a.id)));
      set({ selectedIds: [], selectedId: null });
    },
    copySelection: () => {
      const ids = new Set(get().selectedIds);
      const copied = get()
        .currentAnnos()
        .filter((a) => ids.has(a.id))
        .map(cloneAnno);
      if (copied.length) {
        set({ clipboard: copied, statusMsg: tt(get().locale, "message.copiedBoxes", { count: copied.length }) });
      }
    },
    paste: () => {
      const clip = get().clipboard;
      if (!clip.length) return;
      const newIds: string[] = [];
      mutate((prev) =>
        prev.concat(
          clip.map((a) => {
            const id = uid();
            newIds.push(id);
            const cloned = cloneAnno(a);
            return {
              ...cloned,
              id,
              points: cloned.points.map((p) => [p[0] + 8, p[1] + 8] as Point),
            };
          }),
        ),
      );
      set({ selectedIds: newIds, selectedId: newIds[newIds.length - 1] ?? null });
    },

    undo: () => {
      const img = get().currentImage();
      if (!img) return;
      const path = img.path;
      set((s) => {
        const past = s.past[path] ?? [];
        if (!past.length) return {};
        const prev = past[past.length - 1];
        const cur = s.annos[path] ?? [];
        return {
          annos: { ...s.annos, [path]: prev },
          past: { ...s.past, [path]: past.slice(0, -1) },
          future: { ...s.future, [path]: (s.future[path] ?? []).concat([cur]) },
          dirty: true,
          dirtyPaths: { ...s.dirtyPaths, [path]: true },
        };
      });
    },
    redo: () => {
      const img = get().currentImage();
      if (!img) return;
      const path = img.path;
      set((s) => {
        const future = s.future[path] ?? [];
        if (!future.length) return {};
        const nextArr = future[future.length - 1];
        const cur = s.annos[path] ?? [];
        return {
          annos: { ...s.annos, [path]: nextArr },
          future: { ...s.future, [path]: future.slice(0, -1) },
          past: { ...s.past, [path]: (s.past[path] ?? []).concat([cur]) },
          dirty: true,
          dirtyPaths: { ...s.dirtyPaths, [path]: true },
        };
      });
    },

    toggleView: (key) =>
      set((s) => {
        const view = { ...s.view, [key]: !s.view[key] };
        saveLS(LS.view, view);
        return { view };
      }),
    resetLayout: () => {
      saveLS(LS.view, DEFAULT_VIEW);
      set({ view: { ...DEFAULT_VIEW } });
      get().requestFit("window");
    },
    setOcrModel: (key) => {
      saveLS(LS.ocrModel, key);
      set({ ocrModel: key });
    },
    setLayoutModel: (key) => {
      saveLS(LS.layoutModel, key);
      set({ layoutModel: key });
    },
    setFormulaModel: (key) => {
      saveLS(LS.formulaModel, key);
      set({ formulaModel: key });
    },
    setTableModel: (key) => {
      saveLS(LS.tableModel, key);
      set({ tableModel: key });
    },
    setDevice: (device) => {
      saveLS(LS.device, device);
      set({ device });
    },
    setLocale: (locale) => {
      saveLS(LS.locale, locale);
      set({ locale });
    },

    preannotateCurrent: async () => {
      const img = get().currentImage();
      if (!img || get().busy) return;
      const existing = get().currentAnnos().length;
      if (existing > 0 && !(await confirmReplaceAnnotations(existing))) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.preannotatingCurrent") });
      try {
        const annos = await runPreannotation(img.path);
        applyPreannotation(img.path, annos);
        set({ statusMsg: tt(locale, "message.preannotateCurrentComplete", { count: annos.length }) });
      } catch (e) {
        set({ statusMsg: `${t(locale, "message.preannotateFailed")}: ${String(e)}` });
      } finally {
        set({ busy: false });
      }
    },

    preannotateAll: async () => {
      const images = get().images;
      if (!images.length || get().busy) return;

      let annotatedImageCount = 0;
      let annotationCount = 0;
      try {
        const counts = await Promise.all(
          images.map(async (img) => (await annotationsForPath(img.path)).length),
        );
        for (const count of counts) {
          if (count > 0) {
            annotatedImageCount += 1;
            annotationCount += count;
          }
        }
      } catch (e) {
        set({ statusMsg: `${t(get().locale, "message.inspectAnnotationsFailed")}: ${String(e)}` });
        return;
      }

      if (
        annotationCount > 0 &&
        !(await confirmReplaceBatchAnnotations(
          images.length,
          annotatedImageCount,
          annotationCount,
        ))
      ) {
        return;
      }

      const locale = get().locale;
      set({ busy: true, statusMsg: tt(locale, "message.batchPreannotatingStart", { total: images.length }) });
      let completed = 0;
      const failures: string[] = [];
      try {
        for (const img of images) {
          set({ statusMsg: tt(locale, "message.preannotatingProgress", { current: completed + 1, total: images.length, name: img.name }) });
          try {
            const annos = await runPreannotation(img.path);
            applyPreannotation(img.path, annos);
            completed += 1;
          } catch (e) {
            failures.push(`${img.name}: ${String(e)}`);
          }
        }
        set({
          statusMsg: failures.length
            ? tt(locale, "message.batchPreannotateFinished", { completed, total: images.length, failed: failures.length })
            : tt(locale, "message.batchPreannotateComplete", { completed, total: images.length }),
        });
      } finally {
        set({ busy: false });
      }
    },
    save: async () => {
      const paths = Object.keys(get().dirtyPaths);
      const img = get().currentImage();
      if (!paths.length && img) paths.push(img.path);
      if (!paths.length) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.saving") });
      try {
        for (const path of paths) {
          await saveImageFile(path);
        }
        // Mark saved images as done if they have annotations.
        const annos = get().annos;
        set((s) => ({
          dirty: false,
          dirtyPaths: {},
          images: s.images.map((it) => {
            const list = annos[it.path];
            if (list == null || list.length === 0) return it;
            return it.status === "done" ? it : { ...it, status: "done" as ImageStatus };
          }),
          statusMsg: t(locale, "common.saved"),
        }));
      } catch (e) {
        set({ statusMsg: `${t(locale, "message.saveFailed")}: ${String(e)}` });
      } finally {
        set({ busy: false });
      }
    },

    exportableImages: async () => {
      const payload: {
        path: string;
        boxes: { points: Point[]; transcription: string }[];
      }[] = [];
      for (const img of get().images) {
        const file = await annotationFileForExport(img.path);
        const boxes = file.annotations
          .filter((a) => a.points.length >= 3)
          .map((a) => ({
            points: a.points.map((p) => [p[0], p[1]] as Point),
            transcription: resultText(a),
          }));
        if (boxes.length) payload.push({ path: img.path, boxes });
      }
      return payload;
    },

    refreshModels: async () => {
      try {
        const [models, modelOptions] = await Promise.all([
          api.modelStatus(),
          api.modelOptions(),
        ]);
        const next: Partial<AppState> = { models, modelOptions };
        const state = get();
        if (!modelOptions.ocr_profiles.some((o) => o.key === state.ocrModel) && modelOptions.ocr_profiles[0]) {
          next.ocrModel = modelOptions.ocr_profiles[0].key;
          saveLS(LS.ocrModel, next.ocrModel);
        }
        if (!modelOptions.layout_models.some((o) => o.key === state.layoutModel) && modelOptions.layout_models[0]) {
          next.layoutModel = modelOptions.layout_models[0].key;
          saveLS(LS.layoutModel, next.layoutModel);
        }
        if (!modelOptions.formula_profiles.some((o) => o.key === state.formulaModel) && modelOptions.formula_profiles[0]) {
          next.formulaModel = modelOptions.formula_profiles[0].key;
          saveLS(LS.formulaModel, next.formulaModel);
        }
        if (!modelOptions.table_profiles.some((o) => o.key === state.tableModel) && modelOptions.table_profiles[0]) {
          next.tableModel = modelOptions.table_profiles[0].key;
          saveLS(LS.tableModel, next.tableModel);
        }
        set(next);
      } catch (e) {
        set({ statusMsg: `${t(get().locale, "message.modelConfigLoadFailed")}: ${String(e)}` });
      }
    },
  };
});
