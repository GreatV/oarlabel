// Central application state (zustand).

import { create } from "zustand";
import type {
  Annotation,
  AnnotationResult,
  AnnotationShape,
  Device,
  DeviceOption,
  FitMode,
  ImageAnnotationFile,
  ImageItem,
  ImageStatus,
  InferenceTuning,
  Mode,
  ModelOptions,
  ModelStatus,
  Point,
  PreannBox,
  PreannResult,
  TextRegionInput,
  Theme,
  Tool,
  ViewOptions,
} from "@/types";
import { modeLabel, t, tt, type Locale } from "@/i18n";
import { resultLabel, resultText } from "@/types";
import {
  askSaveAndCompleteCurrent,
  api,
  confirmDiscardChanges,
  confirmReplaceAnnotations,
  confirmReplaceBatchAnnotations,
} from "@/lib/tauri";

function uid(): string {
  return crypto.randomUUID();
}

// ---- lightweight localStorage persistence ----
const LS = {
  view: "oarlabel.view",
  ocrModel: "oarlabel.ocrModel",
  layoutModel: "oarlabel.layoutModel",
  formulaModel: "oarlabel.formulaModel",
  device: "oarlabel.device",
  locale: "oarlabel.locale",
  theme: "oarlabel.theme",
  recentDirs: "oarlabel.recentDirs",
  minBoxSize: "oarlabel.minBoxSize",
  inferenceTuning: "oarlabel.inferenceTuning",
  autoSave: "oarlabel.autoSave",
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

export function normalizeViewOptions(value: unknown): ViewOptions {
  const source = isRecord(value) ? value : {};
  return {
    fileList: typeof source.fileList === "boolean" ? source.fileList : DEFAULT_VIEW.fileList,
    results: typeof source.results === "boolean" ? source.results : DEFAULT_VIEW.results,
    toolbar: typeof source.toolbar === "boolean" ? source.toolbar : DEFAULT_VIEW.toolbar,
    statusBar: typeof source.statusBar === "boolean" ? source.statusBar : DEFAULT_VIEW.statusBar,
    boxes: typeof source.boxes === "boolean" ? source.boxes : DEFAULT_VIEW.boxes,
    labels: typeof source.labels === "boolean" ? source.labels : DEFAULT_VIEW.labels,
    highlight: typeof source.highlight === "boolean" ? source.highlight : DEFAULT_VIEW.highlight,
  };
}

function normalizeStoredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function normalizeStoredLocale(value: unknown): Locale {
  return value === "en-US" || value === "zh-CN" ? value : "zh-CN";
}

export function normalizeRecentDirs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const dir of value) {
    if (typeof dir === "string" && dir.length > 0) unique.add(dir);
    if (unique.size === MAX_RECENT) break;
  }
  return [...unique];
}

function normalizeStoredBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const EMPTY_ANNOTATIONS: Annotation[] = [];

const MAX_RECENT = 8;
const DEFAULT_MIN_BOX_SIZE = 4;
const MIN_BOX_SIZE_LOWER_BOUND = 1;
const MIN_BOX_SIZE_UPPER_BOUND = 128;
const DEFAULT_INFERENCE_TUNING: Required<InferenceTuning> = {
  ocr: { score_threshold: 0.2, box_threshold: 0.45, unclip_ratio: 1.4 },
  text_recognition: { score_threshold: 0 },
  layout: { score_threshold: 0.5, nms_threshold: 0.5, max_elements: 100 },
};

function appendSkipped(locale: Locale, message: string, skipped: number): string {
  if (skipped <= 0) return message;
  const separator = locale === "zh-CN" ? "，" : ", ";
  return `${message}${separator}${tt(locale, "message.regionsSkipped", { skipped })}`;
}

function cloneAnno(a: Annotation): Annotation {
  return {
    id: a.id,
    points: a.points.map((p) => [p[0], p[1]] as Point),
    hidden: a.hidden,
    shape: a.shape,
    results: a.results.map((r) => ({ ...r, value: { ...r.value } })),
  };
}

interface HistorySnapshot {
  annotations: Annotation[];
  status: ImageStatus;
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
  batchRunning: boolean;
  batchTotal: number;
  batchDone: number;
  batchCancelRequested: boolean;
  exportRunning: boolean;
  exportTotal: number;
  exportDone: number;
  exportCancelRequested: boolean;
  models: ModelStatus[];
  modelOptions: ModelOptions | null;
  deviceOptions: DeviceOption[];

  // view + model/device selection
  view: ViewOptions;
  ocrModel: string;
  layoutModel: string;
  formulaModel: string;
  device: Device;
  locale: Locale;
  theme: Theme;
  recentDirs: string[];
  minBoxSize: number;
  inferenceTuning: Required<InferenceTuning>;
  autoSave: boolean;

  // canvas fit request (CanvasStage watches fitNonce)
  fitMode: FitMode | null;
  fitNonce: number;

  // history (per image path)
  past: Record<string, HistorySnapshot[]>;
  future: Record<string, HistorySnapshot[]>;

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

  addAnnotation: (points: Point[], label?: string, shape?: AnnotationShape) => void;
  updateAnnotationPoints: (id: string, points: Point[]) => void;
  setText: (id: string, text: string) => void;
  ensureTextResult: (id: string) => void;
  setAnnotationHidden: (id: string, hidden: boolean) => void;
  /** Update a region's category label (layout/formula/etc.). */
  setLabel: (id: string, label: string) => void;
  removeAnnotation: (id: string) => void;
  removeSelected: () => void;
  copySelection: () => void;
  paste: () => void;
  pasteAt: (anchor?: Point) => void;
  recognizeSelectedText: () => Promise<void>;
  recognizeAllTextBoxes: () => Promise<void>;

  undo: () => void;
  redo: () => void;

  // view + model
  toggleView: (key: keyof ViewOptions) => void;
  resetLayout: () => void;
  setOcrModel: (key: string) => void;
  setLayoutModel: (key: string) => void;
  setFormulaModel: (key: string) => void;
  setDevice: (device: Device) => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  setMinBoxSize: (size: number) => void;
  setInferenceTuning: (tuning: Required<InferenceTuning>) => void;
  setAutoSave: (enabled: boolean) => void;

  preannotateCurrent: () => Promise<void>;
  preannotateAll: () => Promise<void>;
  requestBatchCancel: () => void;
  save: () => Promise<boolean>;
  /** Save and mark the current image done, then advance to the next physical
   *  image. No-op if the save fails. */
  saveAndNext: () => Promise<void>;
  exportableImages: () => Promise<
    { path: string; boxes: { points: Point[]; transcription: string }[] }[] | null
  >;
  requestExportCancel: () => void;

  refreshModels: () => Promise<void>;
}

const MAX_HISTORY = 50;
const LOAD_IPC_CONCURRENCY = 8;
const DIMENSION_UPDATE_BATCH_SIZE = 64;

// Coerce an unknown/stale stored device value back to a known one. Older builds
// stored "auto", which was CPU in practice; normalize it to "cpu".
const VALID_DEVICES: ReadonlySet<string> = new Set(["cpu", "cuda"]);
function normalizeDevice(d: unknown): Device {
  return typeof d === "string" && VALID_DEVICES.has(d) ? (d as Device) : "cpu";
}

// Coerce a stale/invalid stored theme back to a known value, mirroring
// normalizeDevice so the theme switcher never breaks on a bad localStorage hit.
const VALID_THEMES: ReadonlySet<Theme> = new Set(["light", "dark", "system"]);
function normalizeTheme(theme: unknown): Theme {
  return typeof theme === "string" && VALID_THEMES.has(theme as Theme)
    ? (theme as Theme)
    : "system";
}

function normalizeMinBoxSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return DEFAULT_MIN_BOX_SIZE;
  return Math.min(
    MIN_BOX_SIZE_UPPER_BOUND,
    Math.max(MIN_BOX_SIZE_LOWER_BOUND, Math.round(size)),
  );
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeInferenceTuning(value: unknown): Required<InferenceTuning> {
  const source = isRecord(value) ? value : {};
  const ocr = isRecord(source.ocr) ? source.ocr : {};
  const textRecognition = isRecord(source.text_recognition) ? source.text_recognition : {};
  const layout = isRecord(source.layout) ? source.layout : {};
  return {
    ocr: {
      score_threshold: clampNumber(
        ocr.score_threshold,
        DEFAULT_INFERENCE_TUNING.ocr.score_threshold!,
        0,
        1,
      ),
      box_threshold: clampNumber(
        ocr.box_threshold,
        DEFAULT_INFERENCE_TUNING.ocr.box_threshold!,
        0,
        1,
      ),
      unclip_ratio: clampNumber(
        ocr.unclip_ratio,
        DEFAULT_INFERENCE_TUNING.ocr.unclip_ratio!,
        0,
        10,
      ),
    },
    text_recognition: {
      score_threshold: clampNumber(
        textRecognition.score_threshold,
        DEFAULT_INFERENCE_TUNING.text_recognition.score_threshold!,
        0,
        1,
      ),
    },
    layout: {
      score_threshold: clampNumber(
        layout.score_threshold,
        DEFAULT_INFERENCE_TUNING.layout.score_threshold!,
        0,
        1,
      ),
      nms_threshold: clampNumber(
        layout.nms_threshold,
        DEFAULT_INFERENCE_TUNING.layout.nms_threshold!,
        0,
        1,
      ),
      max_elements: Math.round(
        clampNumber(layout.max_elements, DEFAULT_INFERENCE_TUNING.layout.max_elements!, 1, 1000),
      ),
    },
  };
}

function inferShape(points: Point[]): AnnotationShape {
  // Legacy annotation files had no shape tag. Treat four-point boxes as rects
  // so existing detector quads keep the rectangle resize editor after load;
  // new polygon-tool annotations persist shape: "polygon" explicitly.
  return points.length === 4 ? "rect" : "polygon";
}

function normalizeAnnotation(a: Annotation): Annotation {
  const shape: AnnotationShape =
    a.shape === "rect" || a.shape === "polygon" ? a.shape : inferShape(a.points);
  return {
    ...a,
    hidden: a.hidden === true,
    shape,
  };
}

/// Snapshot of the model/mode settings used for a (batch) pre-annotation run.
/// Captured once at the start of a batch so all images in the run use the
/// same config even if the user switches model or mode mid-run.
interface PreannParams {
  mode: Mode;
  ocrModel: string;
  layoutModel: string;
  formulaModel: string;
  device: Device;
  thresholds: InferenceTuning | null;
}

function emptyAnnotationFile(): ImageAnnotationFile {
  return { version: 1, status: "pending", annotations: [] };
}

const VALID_IMAGE_STATUSES: ReadonlySet<ImageStatus> = new Set([
  "pending",
  "preannotated",
  "labeling",
  "done",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function normalizeAnnotationResult(value: unknown): AnnotationResult | null {
  if (!isRecord(value)) return null;
  const { task, source, score } = value;
  if (typeof task !== "string") return null;
  if (source !== "manual" && source !== "auto") return null;
  if (score !== null && (typeof score !== "number" || !Number.isFinite(score))) return null;
  return {
    task,
    source,
    score,
    value: isRecord(value.value) ? value.value : {},
  };
}

function normalizeAnnotationInput(value: unknown): Annotation | null {
  if (!isRecord(value)) return null;
  const points = Array.isArray(value.points) ? value.points.filter(isPoint) : [];
  const results = Array.isArray(value.results)
    ? value.results.map(normalizeAnnotationResult).filter((r): r is AnnotationResult => r !== null)
    : [];
  if (points.length < 2 || results.length === 0) return null;
  const shape =
    value.shape === "rect" || value.shape === "polygon" ? value.shape : inferShape(points);
  return normalizeAnnotation({
    id: typeof value.id === "string" && value.id ? value.id : uid(),
    points,
    hidden: value.hidden === true,
    shape,
    results,
  });
}

function parseAnnotationFile(text: string | null): ImageAnnotationFile {
  if (!text) return emptyAnnotationFile();
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) return emptyAnnotationFile();
  const status = typeof parsed.status === "string" && VALID_IMAGE_STATUSES.has(parsed.status as ImageStatus)
    ? (parsed.status as ImageStatus)
    : "pending";
  const annotations = Array.isArray(parsed.annotations)
    ? parsed.annotations
        .map(normalizeAnnotationInput)
        .filter((a): a is Annotation => a !== null)
    : [];
  return {
    version: 1,
    status,
    annotations,
  };
}

function currentLabel(mode: Mode, explicit?: string): string {
  if (explicit) return explicit;
  if (mode === "formula") return "formula";
  if (mode === "layout") return "layout";
  return "text";
}

/** Restrict bulk recognition to annotations produced for the active task.
 * Explicit single/selection recognition remains available as an intentional
 * conversion workflow, but "recognize all" must never reinterpret unrelated
 * layout/formula regions or annotations hidden by the user. */
function isBulkRecognitionTarget(annotation: Annotation, mode: Mode): boolean {
  if (annotation.hidden) return false;
  if (mode === "ocr") {
    return annotation.results.some((result) => result.task === "text_detection");
  }
  if (mode === "formula") {
    return annotation.results.some(
      (result) =>
        result.task === "layout_detection" &&
        typeof result.value.label === "string" &&
        result.value.label.trim().toLowerCase() === "formula",
    );
  }
  return false;
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
    const currentText = typeof r.value.text === "string" ? r.value.text : "";
    if (currentText === text && r.source === "manual") return r;
    const original =
      r.source === "manual" || typeof r.value.originalText === "string"
        ? {}
        : {
            originalText: currentText,
            originalScore: r.score,
            originalSource: r.source,
          };
    return {
      ...r,
      value: { ...r.value, ...original, text },
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

/** Rewrite a region's category label. The label lives on the
 *  `layout_detection` result's `value.label`; if absent (e.g. a hand-drawn box
 *  that only has text_detection), append a fresh manual layout_detection entry.
 *  Other results, including formula text recognition, are preserved verbatim. */
function setLabelResult(a: Annotation, label: string): Annotation {
  let found = false;
  const results = a.results.map((r) => {
    if (r.task !== "layout_detection") return r;
    found = true;
    const currentLabel = typeof r.value.label === "string" ? r.value.label : "";
    if (currentLabel === label && r.source === "manual") return r;
    const original =
      r.source === "manual" || typeof r.value.originalLabel === "string"
        ? {}
        : {
            originalLabel: currentLabel,
            originalScore: r.score,
            originalSource: r.source,
          };
    return {
      ...r,
      value: { ...r.value, ...original, label },
      score: 1,
      source: "manual" as const,
    };
  });
  if (found) return { ...a, results };
  return {
    ...a,
    results: results.concat({
      task: "layout_detection",
      value: { label },
      score: 1,
      source: "manual",
    }),
  };
}

function markGeometryManual(a: Annotation): Annotation {
  const results = a.results.map((r) => {
    if (r.task !== "text_detection" && r.task !== "layout_detection") return r;
    if (r.source === "manual" && r.score === 1) return r;
    return {
      ...r,
      value: {
        ...r.value,
        originalScore: r.value.originalScore ?? r.score,
        originalSource: r.value.originalSource ?? r.source,
      },
      score: 1,
      source: "manual" as const,
    };
  });
  return { ...a, results };
}

function setAutoTextResult(a: Annotation, text: string, score: number | null): Annotation {
  let found = false;
  const results = a.results.map((r) => {
    if (r.task !== "text_recognition") return r;
    found = true;
    return {
      ...r,
      value: { ...r.value, text },
      score,
      source: "auto" as const,
    };
  });
  if (found) return { ...a, results };
  return {
    ...a,
    results: results.concat({
      task: "text_recognition",
      value: { text },
      score,
      source: "auto",
    }),
  };
}

function setAutoFormulaResult(a: Annotation, latex: string, score: number | null): Annotation {
  let hasLayout = false;
  let hasText = false;
  const results = a.results.map((r) => {
    if (r.task === "layout_detection") {
      hasLayout = true;
      return {
        ...r,
        value: { ...r.value, label: "formula" },
        score: score ?? r.score,
        source: "auto" as const,
      };
    }
    if (r.task === "text_recognition") {
      hasText = true;
      return {
        ...r,
        value: { ...r.value, text: latex, latex },
        score,
        source: "auto" as const,
      };
    }
    return r;
  });
  if (!hasLayout) {
    results.push({
      task: "layout_detection",
      value: { label: "formula" },
      score,
      source: "auto",
    });
  }
  if (!hasText) {
    results.push({
      task: "text_recognition",
      value: { text: latex, latex },
      score,
      source: "auto",
    });
  }
  return { ...a, results };
}

function textAnnotation(
  points: Point[],
  text: string,
  score: number | null,
): Annotation {
  return {
    id: uid(),
    points,
    shape: inferShape(points),
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

function layoutAnnotation(
  points: Point[],
  label: string,
  score: number | null,
): Annotation {
  return {
    id: uid(),
    points,
    shape: inferShape(points),
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
    shape: inferShape(points),
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

  async function mapLimited<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
    shouldContinue: () => boolean = () => true,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (shouldContinue()) {
          const index = next;
          next += 1;
          if (index >= items.length) return;
          results[index] = await mapper(items[index], index);
        }
      }),
    );

    return results;
  }

  // Race guard for opening a workspace. The token is minted at the very start
  // of each open (openFolder / openFiles / openPdf), BEFORE any IPC, so that a
  // slow earlier open can never win over a newer one: if open-A's IPC returns
  // after open-B has already begun, open-A's token is stale and every guarded
  // set / status message / finally is skipped. Without minting up front, two
  // opens would both increment here after their IPCs and the later-finishing
  // (older) one would clobber the newer workspace.
  let loadGeneration = 0;
  type LoadToken = number & { readonly __brand: unique symbol };
  const beginLoad = (): LoadToken => ++loadGeneration as LoadToken;
  const isCurrentLoad = (token: LoadToken): boolean => token === loadGeneration;

  // Snapshot the current model/mode/device so a batch pre-annotation run is
  // self-consistent: a mid-run model/mode switch won't mix configs across
  // images.
  function snapshotPreannParams(): PreannParams {
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
  }

  async function saveImageFile(path: string, status: ImageStatus): Promise<void> {
    const state = get();
    if (!state.images.some((it) => it.path === path)) return;
    let annotations = state.annos[path];
    if (!annotations) {
      annotations = (await loadImageFile(path)).annotations;
    }
    const data: ImageAnnotationFile = {
      version: 1,
      status,
      annotations,
    };
    await api.saveAnnotation(path, JSON.stringify(data, null, 2));
  }

  async function saveCurrentImage(status?: ImageStatus): Promise<boolean> {
    if (get().busy) return false;
    const img = get().currentImage();
    if (!img) return true;
    const locale = get().locale;
    const nextStatus = status ?? img.status;
    set({ busy: true, statusMsg: t(locale, "message.saving") });
    try {
      await saveImageFile(img.path, nextStatus);
      set((s) => {
        const dirtyPaths = { ...s.dirtyPaths };
        delete dirtyPaths[img.path];
        return {
          dirty: Object.keys(dirtyPaths).length > 0,
          dirtyPaths,
          images: s.images.map((it) =>
            it.path === img.path ? { ...it, status: nextStatus } : it,
          ),
          statusMsg: t(locale, "message.currentImageSaved"),
        };
      });
      return true;
    } catch (e) {
      set({ statusMsg: `${t(locale, "message.saveFailed")}: ${String(e)}` });
      return false;
    } finally {
      set({ busy: false });
    }
  }

  async function saveImageAfterBatchPreannotation(path: string): Promise<void> {
    const img = get().images.find((it) => it.path === path);
    if (!img) return;
    await saveImageFile(path, img.status);
    set((s) => {
      const dirtyPaths = { ...s.dirtyPaths };
      delete dirtyPaths[path];
      const isCurrent = s.currentImage()?.path === path;
      const annos = { ...s.annos };
      const past = { ...s.past };
      const future = { ...s.future };
      // The saved sidecar is now the source of truth. Release non-current
      // batch results and their undo stacks so a large batch does not retain
      // every image's annotations and up to 50 history snapshots in memory.
      if (!isCurrent) {
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
      };
    });
  }

  function shouldPromptSaveAndCompleteCurrent(targetIndex: number): boolean {
    const state = get();
    if (targetIndex === state.currentIndex) return false;
    const img = state.currentImage();
    if (!img || img.status === "done") return false;
    const annos = state.annos[img.path] ?? [];
    return !!state.dirtyPaths[img.path] || annos.length > 0;
  }

  async function prepareCurrentImageForSwitch(targetIndex: number): Promise<boolean> {
    if (targetIndex === get().currentIndex) return true;
    const state = get();
    const img = state.currentImage();
    if (state.autoSave) {
      return img && state.dirtyPaths[img.path] ? saveCurrentImage() : true;
    }
    if (!shouldPromptSaveAndCompleteCurrent(targetIndex)) return true;
    let shouldSave: boolean;
    set({ busy: true });
    try {
      shouldSave = await askSaveAndCompleteCurrent(get().locale);
    } catch (error) {
      set({ statusMsg: `${t(get().locale, "message.saveFailed")}: ${String(error)}` });
      return false;
    } finally {
      set({ busy: false });
    }
    if (shouldSave) {
      return saveCurrentImage("done");
    }
    return true;
  }

  async function canDiscardDirty(): Promise<boolean> {
    return !get().dirty || confirmDiscardChanges(get().locale);
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

  async function annotationCountForPath(path: string): Promise<number> {
    const loaded = get().annos[path];
    if (loaded) return loaded.length;
    return (await loadImageFile(path)).annotations.length;
  }

  async function recognizeTextForAnnotations(annotations: Annotation[]): Promise<void> {
    if (get().busy) return;
    const img = get().currentImage();
    const locale = get().locale;
    if (!img) return;
    if (!annotations.length) {
      set({ statusMsg: t(locale, "message.recognizeTextNoBoxes") });
      return;
    }

    const regions: TextRegionInput[] = annotations.map((a) => ({
      id: a.id,
      points: a.points,
    }));
    set({ busy: true, statusMsg: t(locale, "message.recognizingText") });
    try {
      const result = await api.recognizeTextRegions(
        img.path,
        get().ocrModel,
        get().device,
        regions,
        {
          text_recognition: get().inferenceTuning.text_recognition,
        },
      );
      if (result.regions.length) {
        const recognized = new Map(result.regions.map((r) => [r.id, r]));
        mutate(
          (prev) =>
            prev.map((a) => {
              const r = recognized.get(a.id);
              return r ? setAutoTextResult(a, r.text, r.score) : a;
            }),
          { allowDuringBusy: true },
        );
      }
      set({
        statusMsg: appendSkipped(locale, tt(locale, "message.recognizeTextComplete", {
          count: result.regions.length,
        }), result.skipped),
      });
    } catch (e) {
      set({ statusMsg: `${t(locale, "message.recognizeTextFailed")}: ${String(e)}` });
    } finally {
      set({ busy: false });
    }
  }

  async function recognizeFormulaForAnnotations(annotations: Annotation[]): Promise<void> {
    if (get().busy) return;
    const img = get().currentImage();
    const locale = get().locale;
    if (!img) return;
    if (!annotations.length) {
      set({ statusMsg: t(locale, "message.recognizeFormulaNoBoxes") });
      return;
    }

    const regions: TextRegionInput[] = annotations.map((a) => ({
      id: a.id,
      points: a.points,
    }));
    set({ busy: true, statusMsg: t(locale, "message.recognizingFormula") });
    try {
      const result = await api.recognizeFormulaRegions(
        img.path,
        get().formulaModel,
        get().device,
        regions,
      );
      if (result.regions.length) {
        const recognized = new Map(result.regions.map((r) => [r.id, r]));
        mutate(
          (prev) =>
            prev.map((a) => {
              const r = recognized.get(a.id);
              return r ? setAutoFormulaResult(a, r.text, r.score) : a;
            }),
          { allowDuringBusy: true },
        );
      }
      set({
        statusMsg: appendSkipped(locale, tt(locale, "message.recognizeFormulaComplete", {
          count: result.regions.length,
        }), result.skipped),
      });
    } catch (e) {
      set({ statusMsg: `${t(locale, "message.recognizeFormulaFailed")}: ${String(e)}` });
    } finally {
      set({ busy: false });
    }
  }

  async function runPreannotation(
    path: string,
    params: PreannParams = snapshotPreannParams(),
  ): Promise<{ annos: Annotation[]; skipped: number }> {
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
    const boxes: PreannBox[] = result.boxes;
    const annos = boxes.map<Annotation>((b) => {
      const label = b.label ?? null;
      if (mode === "layout") {
        return layoutAnnotation(b.points, label ?? "region", b.score);
      }
      if (mode === "formula") {
        if (b.text == null) {
          throw new Error(
            tt(locale, "message.resultMissingText", { mode: modeLabel(locale, mode) }),
          );
        }
        return recognizedLayoutAnnotation(b.points, label ?? "formula", b.text, b.score);
      }
      if (b.text == null) throw new Error(t(locale, "message.ocrMissingText"));
      return textAnnotation(b.points, b.text, b.score);
    });
    return { annos, skipped: result.skipped };
  }

  function applyPreannotation(path: string, annos: Annotation[]): void {
    set((s) => {
      const isCurrent = s.currentImage()?.path === path;
      const currentStatus = s.images.find((image) => image.path === path)?.status ?? "pending";
      return {
        annos: { ...s.annos, [path]: annos },
        past: {
          ...s.past,
          [path]: (s.past[path] ?? [])
            .concat([{ annotations: s.annos[path] ?? [], status: currentStatus }])
            .slice(-MAX_HISTORY),
        },
        future: { ...s.future, [path]: [] },
        images: s.images.map((it) =>
          it.path === path ? { ...it, status: "preannotated" as ImageStatus } : it,
        ),
        dirty: true,
        dirtyPaths: { ...s.dirtyPaths, [path]: true },
        ...(isCurrent ? { selectedIds: [], selectedId: null } : {}),
      };
    });
  }

  /** Shared loader for a freshly-resolved image list (folder / files / pdf). */
  async function loadImageList(
    raw: Omit<ImageItem, "status">[],
    dir: string | null,
    label: string,
    token: LoadToken,
  ): Promise<void> {
    const images: ImageItem[] = await mapLimited(
      raw,
      LOAD_IPC_CONCURRENCY,
      async (r) => {
        try {
          const file = await loadImageFile(r.path);
          return { ...r, status: file.status };
        } catch {
          return { ...r, status: "pending" as ImageStatus };
        }
      },
      () => isCurrentLoad(token),
    );
    if (!isCurrentLoad(token)) return; // a newer open superseded this one
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
      if (!isCurrentLoad(token)) return;
      set((s) => ({
        annos: { ...s.annos, [images[0].path]: file.annotations },
        images: s.images.map((it) =>
          it.path === images[0].path ? { ...it, status: file.status } : it,
        ),
      }));
    }
    void loadImageDimensions(images, token);
  }

  async function loadImageDimensions(images: ImageItem[], token: LoadToken): Promise<void> {
    let pending = new Map<string, { width: number; height: number }>();

    const flush = () => {
      if (!pending.size || !isCurrentLoad(token)) {
        pending.clear();
        return;
      }
      const updates = pending;
      pending = new Map();
      set((s) => ({
        images: s.images.map((it) => {
          const size = updates.get(it.path);
          return size ? { ...it, width: size.width, height: size.height } : it;
        }),
      }));
    };

    await mapLimited(
      images,
      LOAD_IPC_CONCURRENCY,
      async (img) => {
        try {
          const [width, height] = await api.imageSize(img.path);
          if (!isCurrentLoad(token)) return;
          pending.set(img.path, { width, height });
          if (pending.size >= DIMENSION_UPDATE_BATCH_SIZE) flush();
        } catch {
          // Ignore unreadable dimensions; the image can still be listed.
        }
      },
      () => isCurrentLoad(token),
    );
    flush();
  }

  function pushRecent(dir: string): void {
    const next = [dir, ...get().recentDirs.filter((d) => d !== dir)].slice(0, MAX_RECENT);
    set({ recentDirs: next });
    saveLS(LS.recentDirs, next);
  }

  /** Mutate the current image's annotations with undo bookkeeping. */
  function mutate(
    producer: (prev: Annotation[]) => Annotation[],
    options: { allowDuringBusy?: boolean } = {},
  ): boolean {
    if (get().busy && !options.allowDuringBusy) return false;
    const img = get().currentImage();
    if (!img) return false;
    const path = img.path;
    set((s) => {
      const prev = s.annos[path] ?? [];
      const nextArr = producer(prev);
      const currentStatus = s.images.find((item) => item.path === path)?.status ?? img.status;
      const past = (s.past[path] ?? [])
        .concat([{ annotations: prev, status: currentStatus }])
        .slice(-MAX_HISTORY);
      const images = s.images.map((it) =>
        it.path === path ? { ...it, status: "labeling" as ImageStatus } : it,
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
    return true;
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
    // Batch pre-annotation progress/cancel surfaced to the StatusBar.
    batchRunning: false,
    batchTotal: 0,
    batchDone: 0,
    batchCancelRequested: false,
    exportRunning: false,
    exportTotal: 0,
    exportDone: 0,
    exportCancelRequested: false,
    models: [],
    modelOptions: null,
    deviceOptions: [],

    view: normalizeViewOptions(loadLS<unknown>(LS.view, DEFAULT_VIEW)),
    ocrModel: normalizeStoredString(loadLS<unknown>(LS.ocrModel, null), "ppocrv6_tiny"),
    layoutModel: normalizeStoredString(
      loadLS<unknown>(LS.layoutModel, null),
      "layout_doc_v3",
    ),
    formulaModel: normalizeStoredString(
      loadLS<unknown>(LS.formulaModel, null),
      "pp_formulanet_plus_s",
    ),
    device: normalizeDevice(loadLS<unknown>(LS.device, "cpu")),
    locale: normalizeStoredLocale(loadLS<unknown>(LS.locale, "zh-CN")),
    theme: normalizeTheme(loadLS<unknown>(LS.theme, "system")),
    recentDirs: normalizeRecentDirs(loadLS<unknown>(LS.recentDirs, [])),
    minBoxSize: normalizeMinBoxSize(loadLS<unknown>(LS.minBoxSize, DEFAULT_MIN_BOX_SIZE)),
    inferenceTuning: normalizeInferenceTuning(
      loadLS<unknown>(LS.inferenceTuning, DEFAULT_INFERENCE_TUNING),
    ),
    autoSave: normalizeStoredBoolean(loadLS<unknown>(LS.autoSave, false), false),

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
      if (get().busy) return;
      // Mint the load token BEFORE the discard-prompt and any IPC: a second
      // open started while this one is awaiting would mint a newer token and
      // cause every guarded step below (including finally) to no-op for this.
      const token = beginLoad();
      if (!(await canDiscardDirty())) return;
      if (!isCurrentLoad(token)) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.loadingFolder") });
      try {
        console.info("opening image folder", dir);
        const raw = await api.listImages(dir);
        if (!isCurrentLoad(token)) return;
        console.info("loaded image folder", { dir, count: raw.length });
        await loadImageList(raw, dir, tt(locale, "message.loadedImages", { count: raw.length }), token);
        if (!isCurrentLoad(token)) return;
        pushRecent(dir);
        if (raw.length === 0) {
          set({ statusMsg: t(locale, "message.noImagesFound") });
        }
      } catch (e) {
        console.error("load image folder failed", e);
        if (!isCurrentLoad(token)) return;
        set({ statusMsg: `${t(locale, "message.loadFailed")}: ${String(e)}` });
      } finally {
        if (isCurrentLoad(token)) set({ busy: false });
      }
    },

    openFiles: async (paths) => {
      if (!paths.length) return;
      if (get().busy) return;
      const token = beginLoad();
      if (!(await canDiscardDirty())) return;
      if (!isCurrentLoad(token)) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.loadingImages") });
      try {
        const raw = await api.imageItems(paths);
        if (!isCurrentLoad(token)) return;
        await loadImageList(raw, null, tt(locale, "message.loadedImages", { count: raw.length }), token);
      } catch (e) {
        if (!isCurrentLoad(token)) return;
        set({ statusMsg: `${t(locale, "message.loadFailed")}: ${String(e)}` });
      } finally {
        if (isCurrentLoad(token)) set({ busy: false });
      }
    },

    openPdf: async (pdfPath) => {
      if (get().busy) return;
      const token = beginLoad();
      if (!(await canDiscardDirty())) return;
      if (!isCurrentLoad(token)) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.renderingPdf") });
      try {
        const raw = await api.importPdf(pdfPath);
        if (!isCurrentLoad(token)) return;
        await loadImageList(raw, null, tt(locale, "message.pdfImported", { count: raw.length }), token);
      } catch (e) {
        if (!isCurrentLoad(token)) return;
        set({ statusMsg: `${t(locale, "message.pdfImportFailed")}: ${String(e)}` });
      } finally {
        if (isCurrentLoad(token)) set({ busy: false });
      }
    },

    selectIndex: async (i) => {
      if (get().busy) return;
      const { images } = get();
      if (i < 0 || i >= images.length) return;
      if (!(await prepareCurrentImageForSwitch(i))) return;
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

    addAnnotation: (points, label, shape) => {
      const id = uid();
      const primary = get().mode;
      const resultLabel = currentLabel(primary, label);
      const added = mutate((prev) =>
        prev.concat({
          id,
          points,
          shape: shape ?? inferShape(points),
          results: manualResults(resultLabel),
        }),
      );
      if (added) set({ selectedIds: [id], selectedId: id });
    },
    updateAnnotationPoints: (id, points) =>
      mutate((prev) =>
        prev.map((a) => (a.id === id ? { ...markGeometryManual(a), points } : a)),
      ),
    setText: (id, text) => {
      const current = get().currentAnnos().find((a) => a.id === id);
      const hasText = current?.results.some((r) => r.task === "text_recognition") ?? false;
      if (current && hasText && resultText(current) === text) return;
      mutate((prev) => prev.map((a) => (a.id === id ? setTextResult(a, text) : a)));
    },
    ensureTextResult: (id) => {
      const current = get().currentAnnos().find((a) => a.id === id);
      if (!current || current.results.some((r) => r.task === "text_recognition")) return;
      mutate((prev) => prev.map((a) => (a.id === id ? setTextResult(a, "") : a)));
    },
    setAnnotationHidden: (id, hidden) => {
      const current = get().currentAnnos().find((a) => a.id === id);
      if (!current || current.hidden === hidden) return;
      mutate((prev) => prev.map((a) => (a.id === id ? { ...a, hidden } : a)));
    },
    setLabel: (id, label) => {
      const current = get().currentAnnos().find((a) => a.id === id);
      if (current && resultLabel(current) === label) return;
      mutate((prev) => prev.map((a) => (a.id === id ? setLabelResult(a, label) : a)));
    },
    removeAnnotation: (id) => {
      const removed = mutate((prev) => prev.filter((a) => a.id !== id));
      if (!removed) return;
      set((s) => {
        const ids = s.selectedIds.filter((selectedId) => selectedId !== id);
        return { selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null };
      });
    },
    removeSelected: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      const removed = mutate((prev) => prev.filter((a) => !ids.has(a.id)));
      if (removed) set({ selectedIds: [], selectedId: null });
    },
    copySelection: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      const copied = get().currentAnnos().filter((a) => ids.has(a.id)).map(cloneAnno);
      if (copied.length) {
        set({ clipboard: copied, statusMsg: tt(get().locale, "message.copiedBoxes", { count: copied.length }) });
      }
    },
    paste: () => {
      get().pasteAt();
    },
    pasteAt: (anchor) => {
      const img = get().currentImage();
      // Gate on a current image: mutate() early-returns without one, which
      // would leave newIds empty and the trailing set() would write
      // selectedId: undefined, violating the string | null type (reachable via
      // the native Paste menu item, which isn't disabled like the in-window
      // one).
      if (!img) return;
      const clip = get().clipboard;
      if (!clip.length) return;
      const allPoints = clip.flatMap((a) => a.points);
      const minX = Math.min(...allPoints.map((p) => p[0]));
      const minY = Math.min(...allPoints.map((p) => p[1]));
      const dx = anchor ? anchor[0] - minX : 8;
      const dy = anchor ? anchor[1] - minY : 8;
      const newIds: string[] = [];
      const pasted = mutate((prev) =>
        prev.concat(
          clip.map((a) => {
            const id = uid();
            newIds.push(id);
            const cloned = cloneAnno(a);
            return {
              ...cloned,
              id,
              points: cloned.points.map((p) => [p[0] + dx, p[1] + dy] as Point),
            };
          }),
        ),
      );
      if (pasted) {
        set({ selectedIds: newIds, selectedId: newIds[newIds.length - 1] ?? null });
      }
    },
    recognizeSelectedText: async () => {
      const selected = new Set(get().selectedIds);
      if (!selected.size) {
        set({ statusMsg: t(get().locale, "message.recognizeTextNoSelection") });
        return;
      }
      const annotations = get().currentAnnos().filter((a) => selected.has(a.id));
      if (get().mode === "formula") {
        await recognizeFormulaForAnnotations(annotations);
      } else {
        await recognizeTextForAnnotations(annotations);
      }
    },
    recognizeAllTextBoxes: async () => {
      const mode = get().mode;
      const annotations = get()
        .currentAnnos()
        .filter((annotation) => isBulkRecognitionTarget(annotation, mode));
      if (mode === "formula") {
        await recognizeFormulaForAnnotations(annotations);
      } else {
        await recognizeTextForAnnotations(annotations);
      }
    },

    undo: () => {
      if (get().busy) return;
      const img = get().currentImage();
      if (!img) return;
      const path = img.path;
      set((s) => {
        const past = s.past[path] ?? [];
        if (!past.length) return {};
        const prev = past[past.length - 1];
        const currentStatus = s.images.find((item) => item.path === path)?.status ?? img.status;
        const cur: HistorySnapshot = {
          annotations: s.annos[path] ?? [],
          status: currentStatus,
        };
        const validIds = new Set(prev.annotations.map((annotation) => annotation.id));
        const selectedIds = s.selectedIds.filter((id) => validIds.has(id));
        return {
          annos: { ...s.annos, [path]: prev.annotations },
          past: { ...s.past, [path]: past.slice(0, -1) },
          future: { ...s.future, [path]: (s.future[path] ?? []).concat([cur]) },
          images: s.images.map((item) =>
            item.path === path ? { ...item, status: prev.status } : item,
          ),
          dirty: true,
          dirtyPaths: { ...s.dirtyPaths, [path]: true },
          selectedIds,
          selectedId: selectedIds[selectedIds.length - 1] ?? null,
        };
      });
    },
    redo: () => {
      if (get().busy) return;
      const img = get().currentImage();
      if (!img) return;
      const path = img.path;
      set((s) => {
        const future = s.future[path] ?? [];
        if (!future.length) return {};
        const next = future[future.length - 1];
        const currentStatus = s.images.find((item) => item.path === path)?.status ?? img.status;
        const cur: HistorySnapshot = {
          annotations: s.annos[path] ?? [],
          status: currentStatus,
        };
        const validIds = new Set(next.annotations.map((annotation) => annotation.id));
        const selectedIds = s.selectedIds.filter((id) => validIds.has(id));
        return {
          annos: { ...s.annos, [path]: next.annotations },
          future: { ...s.future, [path]: future.slice(0, -1) },
          past: { ...s.past, [path]: (s.past[path] ?? []).concat([cur]) },
          images: s.images.map((item) =>
            item.path === path ? { ...item, status: next.status } : item,
          ),
          dirty: true,
          dirtyPaths: { ...s.dirtyPaths, [path]: true },
          selectedIds,
          selectedId: selectedIds[selectedIds.length - 1] ?? null,
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
    setDevice: (device) => {
      const next = normalizeDevice(device);
      saveLS(LS.device, next);
      set({ device: next });
    },
    setLocale: (locale) => {
      saveLS(LS.locale, locale);
      set({ locale });
    },
    setTheme: (theme) => {
      const next = normalizeTheme(theme);
      saveLS(LS.theme, next);
      set({ theme: next });
    },
    setMinBoxSize: (size) => {
      const next = normalizeMinBoxSize(size);
      saveLS(LS.minBoxSize, next);
      set({ minBoxSize: next });
    },
    setInferenceTuning: (tuning) => {
      const next = normalizeInferenceTuning(tuning);
      saveLS(LS.inferenceTuning, next);
      set({ inferenceTuning: next });
    },
    setAutoSave: (enabled) => {
      saveLS(LS.autoSave, enabled);
      set({ autoSave: enabled });
    },

    preannotateCurrent: async () => {
      const img = get().currentImage();
      if (!img || get().busy) return;
      const locale = get().locale;
      set({ busy: true });
      try {
        const existing = get().currentAnnos().length;
        if (existing > 0 && !(await confirmReplaceAnnotations(locale, existing))) return;
        set({ statusMsg: t(locale, "message.preannotatingCurrent") });
        const { annos, skipped } = await runPreannotation(img.path);
        applyPreannotation(img.path, annos);
        const base = tt(locale, "message.preannotateCurrentComplete", { count: annos.length });
        set({
          statusMsg: appendSkipped(locale, base, skipped),
        });
      } catch (e) {
        set({ statusMsg: `${t(locale, "message.preannotateFailed")}: ${String(e)}` });
      } finally {
        set({ busy: false });
      }
    },

    preannotateAll: async () => {
      const images = get().images;
      if (!images.length || get().busy) return;
      const locale = get().locale;
      set({
        busy: true,
        batchRunning: true,
        batchTotal: images.length,
        batchDone: 0,
        batchCancelRequested: false,
        statusMsg: t(locale, "message.inspectingAnnotations"),
      });

      // Pre-check existing annotations sequentially (not Promise.all, which
      // fired one IPC call per image and could swamp the bridge on large
      // folders). We only need counts for the replace-confirmation prompt.
      let annotatedImageCount = 0;
      let annotationCount = 0;
      try {
        for (let index = 0; index < images.length; index += 1) {
          if (get().batchCancelRequested) {
            set({
              busy: false,
              batchRunning: false,
              batchCancelRequested: false,
              statusMsg: tt(locale, "message.batchPreannotateCancelled", {
                completed: 0,
                total: images.length,
              }),
            });
            return;
          }
          const img = images[index];
          set({
            batchDone: index,
            statusMsg: tt(locale, "message.inspectingAnnotationsProgress", {
              current: index + 1,
              total: images.length,
              name: img.name,
            }),
          });
          const count = await annotationCountForPath(img.path);
          if (count > 0) {
            annotatedImageCount += 1;
            annotationCount += count;
          }
        }
      } catch (e) {
        set({
          busy: false,
          batchRunning: false,
          batchCancelRequested: false,
          statusMsg: `${t(get().locale, "message.inspectAnnotationsFailed")}: ${String(e)}`,
        });
        return;
      }

      if (get().batchCancelRequested) {
        set({
          busy: false,
          batchRunning: false,
          batchCancelRequested: false,
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
          );
          if (!replace) {
            set({ busy: false, batchRunning: false, batchCancelRequested: false });
            return;
          }
        } catch (error) {
          set({
            busy: false,
            batchRunning: false,
            batchCancelRequested: false,
            statusMsg: `${t(get().locale, "message.preannotateFailed")}: ${String(error)}`,
          });
          return;
        }
      }

      // Snapshot model/mode/device once so the whole batch uses one
      // consistent config; a mid-run switch won't mix results.
      const params = snapshotPreannParams();
      set({
        busy: true,
        batchRunning: true,
        batchTotal: images.length,
        batchDone: 0,
        statusMsg: tt(locale, "message.batchPreannotatingStart", { total: images.length }),
      });
      let completed = 0;
      let skippedTotal = 0;
      const failures: string[] = [];
      let cancelled = false;
      try {
        for (let i = 0; i < images.length; i++) {
          // Honor a cancel request between images.
          if (get().batchCancelRequested) {
            cancelled = true;
            break;
          }
          const img = images[i];
          set({
            batchDone: i,
            statusMsg: tt(locale, "message.preannotatingProgressSaving", { current: i + 1, total: images.length, name: img.name }),
          });
          try {
            const { annos, skipped } = await runPreannotation(img.path, params);
            applyPreannotation(img.path, annos);
            await saveImageAfterBatchPreannotation(img.path);
            skippedTotal += skipped;
            completed += 1;
          } catch (e) {
            if (get().batchCancelRequested) {
              cancelled = true;
              break;
            }
            failures.push(`${img.name}: ${String(e)}`);
          }
        }
        const base = cancelled
          ? tt(locale, "message.batchPreannotateCancelled", { completed, total: images.length })
          : failures.length
            ? tt(locale, "message.batchPreannotateFinished", { completed, total: images.length, failed: failures.length })
            : tt(locale, "message.batchPreannotateComplete", { completed, total: images.length });
        if (failures.length) {
          console.error(`Batch pre-annotation failures:\n${failures.join("\n")}`);
        }
        set({
          statusMsg: appendSkipped(locale, base, skippedTotal),
        });
      } finally {
        set({ busy: false, batchRunning: false, batchCancelRequested: false });
      }
    },

    requestBatchCancel: () => {
      if (get().batchRunning) {
        set({ batchCancelRequested: true });
        void api.cancelPreannotation().catch(() => undefined);
      }
    },
    save: async () => {
      return saveCurrentImage();
    },
    saveAndNext: async () => {
      const ok = await saveCurrentImage("done");
      // Only advance when the save actually succeeded; on failure stay put so
      // the user sees the error instead of silently moving on unsaved.
      if (ok) void get().selectIndex(get().currentIndex + 1);
    },

    exportableImages: async () => {
      if (get().exportRunning) return null;
      const images = [...get().images];
      set({
        exportRunning: true,
        exportTotal: images.length,
        exportDone: 0,
        exportCancelRequested: false,
      });
      try {
        const collected = await mapLimited(
          images,
          LOAD_IPC_CONCURRENCY,
          async (img) => {
            const file = await annotationFileForExport(img.path);
            const boxes = file.annotations
              .filter(
                (a) =>
                  a.points.length >= 3 &&
                  a.results.some((r) => r.task === "text_recognition"),
              )
              .map((a) => ({
                points: a.points.map((p) => [p[0], p[1]] as Point),
                transcription: resultText(a),
              }));
            set((s) => ({ exportDone: Math.min(s.exportTotal, s.exportDone + 1) }));
            return boxes.length ? { path: img.path, boxes } : null;
          },
          () => !get().exportCancelRequested,
        );
        if (get().exportCancelRequested) return null;
        return collected.filter((item) => item !== null);
      } finally {
        set({ exportRunning: false });
      }
    },
    requestExportCancel: () => {
      if (get().exportRunning) set({ exportCancelRequested: true });
    },

    refreshModels: async () => {
      try {
        const [models, modelOptions, deviceOptions] = await Promise.all([
          api.modelStatus(),
          api.modelOptions(),
          api.availableDevices(),
        ]);
        const next: Partial<AppState> = { models, modelOptions, deviceOptions };
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
        if (!deviceOptions.some((o) => o.key === state.device) && deviceOptions[0]) {
          next.device = deviceOptions[0].key;
          saveLS(LS.device, next.device);
        }
        set(next);
      } catch (e) {
        set({ statusMsg: `${t(get().locale, "message.modelConfigLoadFailed")}: ${String(e)}` });
      }
    },
  };
});
