// Central application state (zustand).

import { create } from "zustand";
import type {
  Annotation,
  AnnotationResult,
  AnnotationShape,
  Device,
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
import { t, tt, type Locale } from "@/i18n";
import { resultLabel, resultText } from "@/types";
import {
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
  tableModel: "oarlabel.tableModel",
  device: "oarlabel.device",
  locale: "oarlabel.locale",
  theme: "oarlabel.theme",
  recentDirs: "oarlabel.recentDirs",
  minBoxSize: "oarlabel.minBoxSize",
  inferenceTuning: "oarlabel.inferenceTuning",
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
const DEFAULT_MIN_BOX_SIZE = 4;
const MIN_BOX_SIZE_LOWER_BOUND = 1;
const MIN_BOX_SIZE_UPPER_BOUND = 128;
const DEFAULT_INFERENCE_TUNING: Required<InferenceTuning> = {
  ocr: { score_threshold: 0.2, box_threshold: 0.45, unclip_ratio: 1.4 },
  text_recognition: { score_threshold: 0 },
  layout: { score_threshold: 0.5, nms_threshold: 0.5, max_elements: 100 },
};

function cloneAnno(a: Annotation): Annotation {
  return {
    id: a.id,
    points: a.points.map((p) => [p[0], p[1]] as Point),
    hidden: a.hidden,
    shape: a.shape,
    results: a.results.map((r) => ({ ...r, value: { ...r.value } })),
    // Preserve parentId so paste can rebuild the parent→child tree. Dropping
    // it silently defeats the remap in paste() (children become orphans).
    parentId: a.parentId,
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
  // Active annotation modes (multi-select). The last element is the "primary"
  // mode — used as the default label for manually drawn boxes. Toggling a mode
  // pushes it to the end so the most recently selected mode becomes primary.
  modes: Mode[];
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
  theme: Theme;
  recentDirs: string[];
  minBoxSize: number;
  inferenceTuning: Required<InferenceTuning>;

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
  toggleMode: (m: Mode) => void;
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  requestFit: (mode: FitMode) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;

  addAnnotation: (points: Point[], label?: string, shape?: AnnotationShape) => void;
  updateAnnotationPoints: (id: string, points: Point[]) => void;
  /** Move a region together with its children by a delta (single undo step). */
  moveAnnotationTree: (parentId: string, dx: number, dy: number) => void;
  setText: (id: string, text: string) => void;
  ensureTextResult: (id: string) => void;
  setAnnotationHidden: (id: string, hidden: boolean) => void;
  /** Update a region's category label (layout/formula/table/…). */
  setLabel: (id: string, label: string) => void;
  removeAnnotation: (id: string) => void;
  removeSelected: () => void;
  copySelection: () => void;
  paste: () => void;
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
  setTableModel: (key: string) => void;
  setDevice: (device: Device) => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  setMinBoxSize: (size: number) => void;
  setInferenceTuning: (tuning: Required<InferenceTuning>) => void;

  preannotateCurrent: () => Promise<void>;
  preannotateAll: () => Promise<void>;
  requestBatchCancel: () => void;
  save: () => Promise<boolean>;
  /** Save the current image, then advance to the next one (physical next,
   *  ignoring status). No-op if the save fails. */
  saveAndNext: () => Promise<void>;
  exportableImages: () => Promise<
    { path: string; boxes: { points: Point[]; transcription: string }[] }[]
  >;

  refreshModels: () => Promise<void>;
}

const MAX_HISTORY = 50;

// Coerce an unknown/stale stored device value back to a known one. localStorage
// may hold a value from an older build (e.g. a renamed option); without this,
// StatusBar's device lookup fell back to the raw string (fine now) but the
// native device menu would also desync, so normalize at the source.
const VALID_DEVICES: ReadonlySet<Device> = new Set(["auto", "cpu", "cuda"]);
function normalizeDevice(d: Device): Device {
  return VALID_DEVICES.has(d) ? d : "auto";
}

// Coerce a stale/invalid stored theme back to a known value, mirroring
// normalizeDevice so the theme switcher never breaks on a bad localStorage hit.
const VALID_THEMES: ReadonlySet<Theme> = new Set(["light", "dark", "system"]);
function normalizeTheme(theme: Theme): Theme {
  return VALID_THEMES.has(theme) ? theme : "system";
}

function normalizeMinBoxSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_MIN_BOX_SIZE;
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

function normalizeInferenceTuning(value: Partial<InferenceTuning>): Required<InferenceTuning> {
  const ocr = value.ocr ?? {};
  const textRecognition = value.text_recognition ?? {};
  const layout = value.layout ?? {};
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
    parentId: a.parentId ?? null,
  };
}

function annotationBBox(a: Pick<Annotation, "points">): {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
  area: number;
} {
  const xs = a.points.map((p) => p[0]);
  const ys = a.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x, y, maxX, maxY, area: Math.max(0, maxX - x) * Math.max(0, maxY - y) };
}

function hasLayoutResult(a: Annotation): boolean {
  return a.results.some((r) => r.task === "layout_detection");
}

function parentForManualLeaf(points: Point[], prev: Annotation[]): string | null {
  const childBox = annotationBBox({ points });
  let best: { id: string; area: number } | null = null;
  for (const candidate of prev) {
    if (candidate.parentId || !hasLayoutResult(candidate)) continue;
    const box = annotationBBox(candidate);
    const contains =
      childBox.x >= box.x &&
      childBox.y >= box.y &&
      childBox.maxX <= box.maxX &&
      childBox.maxY <= box.maxY;
    if (!contains) continue;
    if (!best || box.area < best.area) best = { id: candidate.id, area: box.area };
  }
  return best?.id ?? null;
}

/// Snapshot of the model/mode settings used for a (batch) pre-annotation run.
/// Captured once at the start of a batch so all images in the run use the
/// same config even if the user switches model or mode mid-run.
interface PreannParams {
  modes: Mode[];
  ocrModel: string;
  layoutModel: string;
  formulaModel: string;
  tableModel: string;
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
  const parentId =
    typeof value.parentId === "string" ? value.parentId : value.parentId === null ? null : null;
  return normalizeAnnotation({
    id: typeof value.id === "string" && value.id ? value.id : uid(),
    points,
    hidden: value.hidden === true,
    shape,
    parentId,
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
 *  Other results (text_recognition for formula/table LaTeX, reading_order, …)
 *  are preserved verbatim. */
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

interface AnnoOpts {
  /** Parent region id, for children produced by the structured pipeline. */
  parentId?: string | null;
  /** Stable editing shape. Four-point detector boxes are rect-like even when
   *  slightly tilted, so the default shape inference is point-count based. */
  shape?: AnnotationShape;
  /** Explicit id (normally a fresh uid; the structured pipeline passes its own
   *  so the linkage `parentId` can reference a region's id). */
  id?: string;
}

function textAnnotation(
  points: Point[],
  text: string,
  score: number | null,
  opts: AnnoOpts = {},
): Annotation {
  return {
    id: opts.id ?? uid(),
    points,
    shape: opts.shape ?? inferShape(points),
    parentId: opts.parentId ?? null,
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

// OCR text region plus a reading-order position. Boxes arrive from the backend
// already sorted into reading order, so `index` is just the array position.
function readingOrderAnnotation(
  points: Point[],
  text: string,
  index: number,
  score: number | null,
  opts: AnnoOpts = {},
): Annotation {
  const base = textAnnotation(points, text, score, opts);
  return {
    ...base,
    results: base.results.concat({
      task: "reading_order",
      value: { index },
      score: null,
      source: "auto",
    }),
  };
}

function layoutAnnotation(
  points: Point[],
  label: string,
  score: number | null,
  opts: AnnoOpts = {},
): Annotation {
  return {
    id: opts.id ?? uid(),
    points,
    shape: opts.shape ?? inferShape(points),
    parentId: opts.parentId ?? null,
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
  opts: AnnoOpts = {},
): Annotation {
  return {
    id: opts.id ?? uid(),
    points,
    shape: opts.shape ?? inferShape(points),
    parentId: opts.parentId ?? null,
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
    const {
      modes,
      ocrModel,
      layoutModel,
      formulaModel,
      tableModel,
      device,
      inferenceTuning,
    } = get();
    return {
      modes,
      ocrModel,
      layoutModel,
      formulaModel,
      tableModel,
      device,
      thresholds: {
        ocr: inferenceTuning.ocr,
        text_recognition: inferenceTuning.text_recognition,
      },
    };
  }

  async function saveImageFile(path: string, finalStatus: ImageStatus): Promise<void> {
    const state = get();
    if (!state.images.some((it) => it.path === path)) return;
    let annotations = state.annos[path];
    if (!annotations) {
      annotations = (await loadImageFile(path)).annotations;
    }
    // Write the final status to disk so it matches the in-memory value after
    // save. The previous version wrote the live (pre-done) status here and
    // then flipped the memory state, so re-opening the folder lost "done".
    const data: ImageAnnotationFile = {
      version: 1,
      status: finalStatus,
      annotations,
    };
    await api.saveAnnotation(path, JSON.stringify(data, null, 2));
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

  async function annotationsForPath(path: string): Promise<Annotation[]> {
    const loaded = get().annos[path];
    if (loaded) return loaded;
    const file = await loadImageFile(path);
    set((s) => ({ annos: { ...s.annos, [path]: file.annotations } }));
    return file.annotations;
  }

  async function recognizeTextForAnnotations(annotations: Annotation[]): Promise<void> {
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
        mutate((prev) =>
          prev.map((a) => {
            const r = recognized.get(a.id);
            return r ? setAutoTextResult(a, r.text, r.score) : a;
          }),
        );
      }
      const skipped =
        result.skipped > 0 ? `，${tt(locale, "message.regionsSkipped", { skipped: result.skipped })}` : "";
      set({
        statusMsg: `${tt(locale, "message.recognizeTextComplete", {
          count: result.regions.length,
        })}${skipped}`,
      });
    } catch (e) {
      set({ statusMsg: `${t(locale, "message.recognizeTextFailed")}: ${String(e)}` });
    } finally {
      set({ busy: false });
    }
  }

  async function runPreannotation(
    path: string,
    params: PreannParams = snapshotPreannParams(),
  ): Promise<{ annos: Annotation[]; skipped: number }> {
    const { modes, ocrModel, layoutModel, formulaModel, tableModel, device, thresholds } = params;
    const locale = get().locale;
    // Structured pipeline: layout regions as parents, recognition results as
    // children linked via id/parent_id. One backend call covers all active
    // modes; which recognizers run is decided backend-side by `modes`.
    const result: PreannResult = await api.preannotate(
      path,
      "structure",
      ocrModel,
      layoutModel,
      formulaModel,
      tableModel,
      device,
      modes,
      thresholds,
    );
    const boxes: PreannBox[] = result.boxes;
    const annos = boxes.map<Annotation>((b) => {
      const parentId = b.parent_id ?? null;
      const label = b.label ?? null;
      // Region parent from the structured pipeline (carries an id): always a
      // plain layout region, kept as a parent for its children to attach to.
      if (b.id) {
        return layoutAnnotation(b.points, label ?? "region", b.score, { id: b.id });
      }
      // reading-order text line (ocr+reading, structured or flat) — needs text.
      if (b.order != null) {
        if (b.text == null) throw new Error(t(locale, "message.ocrMissingText"));
        return readingOrderAnnotation(b.points, b.text, b.order, b.score, { parentId });
      }
      // Formula/table box (recognized LaTeX / table structure). Both the
      // structured child and the flat whole-image run carry label + text.
      if (label === "formula" || label === "table") {
        if (b.text == null)
          throw new Error(tt(locale, "message.resultMissingText", { mode: label }));
        return recognizedLayoutAnnotation(b.points, label, b.text, b.score, { parentId });
      }
      // OCR text line: label is "text" (structured child) OR null (flat OCR run
      // — run_ocr emits text boxes without a label). Either way it's text.
      if (label === "text" || label === null) {
        if (b.text == null) throw new Error(t(locale, "message.ocrMissingText"));
        return textAnnotation(b.points, b.text, b.score, { parentId });
      }
      // Anything else with a layout label is a plain layout region.
      return layoutAnnotation(b.points, label, b.score, { parentId });
    });
    return { annos, skipped: result.skipped };
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
    token: LoadToken,
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
    // lazily fill in dimensions; each callback re-checks the token so a stale
    // resolution can't mutate a newer workspace's image list.
    for (let i = 0; i < images.length; i++) {
      api
        .imageSize(images[i].path)
        .then(([w, h]) => {
          if (!isCurrentLoad(token)) return;
          set((s) => ({
            images: s.images.map((it) =>
              it.path === images[i].path ? { ...it, width: w, height: h } : it,
            ),
          }));
        })
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
    modes: ["ocr"],
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
    models: [],
    modelOptions: null,

    view: loadLS<ViewOptions>(LS.view, DEFAULT_VIEW),
    ocrModel: loadLS<string>(LS.ocrModel, "ppocrv6_tiny"),
    layoutModel: loadLS<string>(LS.layoutModel, "layout_doc_v3"),
    formulaModel: loadLS<string>(LS.formulaModel, "pp_formulanet_plus_s"),
    tableModel: loadLS<string>(LS.tableModel, "slanet_plus"),
    device: normalizeDevice(loadLS<Device>(LS.device, "auto")),
    locale: loadLS<Locale>(LS.locale, "zh-CN"),
    theme: normalizeTheme(loadLS<Theme>(LS.theme, "system")),
    recentDirs: loadLS<string[]>(LS.recentDirs, []),
    minBoxSize: normalizeMinBoxSize(loadLS<number>(LS.minBoxSize, DEFAULT_MIN_BOX_SIZE)),
    inferenceTuning: normalizeInferenceTuning(
      loadLS<Partial<InferenceTuning>>(LS.inferenceTuning, DEFAULT_INFERENCE_TUNING),
    ),

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

    toggleMode: (mode) =>
      set((s) => {
        const has = s.modes.includes(mode);
        // Never allow removing the last active mode — at least one must stay
        // so pre-annotation/manual-draw always have a primary mode.
        if (has && s.modes.length <= 1) return {};
        const modes = has
          ? s.modes.filter((m) => m !== mode)
          : [...s.modes, mode]; // append → becomes the new primary (last)
        return { modes, selectedIds: [], selectedId: null };
      }),
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
      const primary = get().modes[get().modes.length - 1];
      const resultLabel = currentLabel(primary, label);
      mutate((prev) => {
        const parentId =
          resultLabel === "layout" ? null : parentForManualLeaf(points, prev);
        return prev.concat({
          id,
          points,
          shape: shape ?? inferShape(points),
          parentId,
          results: manualResults(resultLabel),
        });
      });
      set({ selectedIds: [id], selectedId: id });
    },
    updateAnnotationPoints: (id, points) =>
      mutate((prev) =>
        prev.map((a) => (a.id === id ? { ...markGeometryManual(a), points } : a)),
      ),
    moveAnnotationTree: (parentId, dx, dy) => {
      if (dx === 0 && dy === 0) return;
      mutate((prev) =>
        prev.map((a) =>
          // The region itself and every child whose parentId points at it.
          a.id === parentId || a.parentId === parentId
            ? {
                ...markGeometryManual(a),
                points: a.points.map((p) => [p[0] + dx, p[1] + dy] as Point),
              }
            : a,
        ),
      );
    },
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
      // Cascade: removing a region also drops its children.
      mutate((prev) => prev.filter((a) => a.id !== id && a.parentId !== id));
      set((s) => {
        const ids = s.selectedIds.filter((x) => x !== id);
        return { selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null };
      });
    },
    removeSelected: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      // Cascade: any selected region removes its children too.
      mutate((prev) =>
        prev.filter((a) => !ids.has(a.id) && !(a.parentId && ids.has(a.parentId))),
      );
      set({ selectedIds: [], selectedId: null });
    },
    copySelection: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      const all = get().currentAnnos();
      // When a parent is selected, bring its children along so paste can
      // reconstruct the tree. Selected children are included directly.
      const selected = all.filter((a) => ids.has(a.id));
      const childOfSelected = new Set(selected.map((a) => a.id));
      const children = all.filter((a) => a.parentId && childOfSelected.has(a.parentId));
      const copied = [...selected, ...children].map(cloneAnno);
      if (copied.length) {
        set({ clipboard: copied, statusMsg: tt(get().locale, "message.copiedBoxes", { count: copied.length }) });
      }
    },
    paste: () => {
      const img = get().currentImage();
      // Gate on a current image: mutate() early-returns without one, which
      // would leave newIds empty and the trailing set() would write
      // selectedId: undefined, violating the string | null type (reachable via
      // the native Paste menu item, which isn't disabled like the in-window
      // one).
      if (!img) return;
      const clip = get().clipboard;
      if (!clip.length) return;
      // Re-id parents first, then remap children's parentId to the new ids.
      const idMap = new Map<string, string>();
      const newIds: string[] = [];
      for (const a of clip) {
        if (!a.parentId) idMap.set(a.id, uid());
      }
      mutate((prev) =>
        prev.concat(
          clip.map((a) => {
            const id = a.parentId ? (idMap.get(a.parentId) ?? uid()) : idMap.get(a.id)!;
            newIds.push(id);
            const cloned = cloneAnno(a);
            return {
              ...cloned,
              id,
              parentId: a.parentId ? (idMap.get(a.parentId) ?? null) : null,
              points: cloned.points.map((p) => [p[0] + 8, p[1] + 8] as Point),
            };
          }),
        ),
      );
      set({ selectedIds: newIds, selectedId: newIds[newIds.length - 1] ?? null });
    },
    recognizeSelectedText: async () => {
      const selected = new Set(get().selectedIds);
      if (!selected.size) {
        set({ statusMsg: t(get().locale, "message.recognizeTextNoSelection") });
        return;
      }
      await recognizeTextForAnnotations(get().currentAnnos().filter((a) => selected.has(a.id)));
    },
    recognizeAllTextBoxes: async () => {
      await recognizeTextForAnnotations(get().currentAnnos());
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

    preannotateCurrent: async () => {
      const img = get().currentImage();
      if (!img || get().busy) return;
      const existing = get().currentAnnos().length;
      if (existing > 0 && !(await confirmReplaceAnnotations(get().locale, existing))) return;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.preannotatingCurrent") });
      try {
        const { annos, skipped } = await runPreannotation(img.path);
        applyPreannotation(img.path, annos);
        const base = tt(locale, "message.preannotateCurrentComplete", { count: annos.length });
        set({
          statusMsg:
            skipped > 0
              ? `${base} · ${tt(locale, "message.regionsSkipped", { skipped })}`
              : base,
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

      // Pre-check existing annotations sequentially (not Promise.all, which
      // fired one IPC call per image and could swamp the bridge on large
      // folders). We only need counts for the replace-confirmation prompt.
      let annotatedImageCount = 0;
      let annotationCount = 0;
      try {
        for (const img of images) {
          const count = (await annotationsForPath(img.path)).length;
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
          get().locale,
          images.length,
          annotatedImageCount,
          annotationCount,
        ))
      ) {
        return;
      }

      const locale = get().locale;
      // Snapshot model/mode/device once so the whole batch uses one
      // consistent config — a mid-run switch won't mix results.
      const params = snapshotPreannParams();
      set({
        busy: true,
        batchRunning: true,
        batchTotal: images.length,
        batchDone: 0,
        batchCancelRequested: false,
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
            statusMsg: tt(locale, "message.preannotatingProgress", { current: i + 1, total: images.length, name: img.name }),
          });
          try {
            const { annos, skipped } = await runPreannotation(img.path, params);
            applyPreannotation(img.path, annos);
            skippedTotal += skipped;
            completed += 1;
          } catch (e) {
            failures.push(`${img.name}: ${String(e)}`);
          }
        }
        const base = cancelled
          ? tt(locale, "message.batchPreannotateCancelled", { completed, total: images.length })
          : failures.length
            ? tt(locale, "message.batchPreannotateFinished", { completed, total: images.length, failed: failures.length })
            : tt(locale, "message.batchPreannotateComplete", { completed, total: images.length });
        set({
          statusMsg:
            skippedTotal > 0
              ? `${base} · ${tt(locale, "message.regionsSkipped", { skipped: skippedTotal })}`
              : base,
        });
      } finally {
        set({ busy: false, batchRunning: false, batchCancelRequested: false });
      }
    },

    requestBatchCancel: () => {
      if (get().batchRunning) set({ batchCancelRequested: true });
    },
    save: async () => {
      const paths = Object.keys(get().dirtyPaths);
      const img = get().currentImage();
      if (!paths.length && img) paths.push(img.path);
      if (!paths.length) return true;
      const locale = get().locale;
      set({ busy: true, statusMsg: t(locale, "message.saving") });
      try {
        // Determine the final status for each saved path up front and write it
        // to disk in the same pass, so disk and memory agree afterwards. Only
        // paths that were actually saved are touched — previously every loaded
        // image with annotations got marked "done" even if it was only viewed.
        const annos = get().annos;
        const saved = new Set(paths);
        const finalStatus: Record<string, ImageStatus> = {};
        for (const path of paths) {
          const list = annos[path];
          finalStatus[path] =
            list != null && list.length > 0 ? "done" : "pending";
          await saveImageFile(path, finalStatus[path]);
        }
        set((s) => ({
          dirty: false,
          dirtyPaths: {},
          images: s.images.map((it) =>
            saved.has(it.path) ? { ...it, status: finalStatus[it.path] } : it,
          ),
          statusMsg: t(locale, "common.saved"),
        }));
        return true;
      } catch (e) {
        set({ statusMsg: `${t(locale, "message.saveFailed")}: ${String(e)}` });
        return false;
      } finally {
        set({ busy: false });
      }
    },
    saveAndNext: async () => {
      const ok = await get().save();
      // Only advance when the save actually succeeded; on failure stay put so
      // the user sees the error instead of silently moving on unsaved.
      if (ok) get().next();
    },

    exportableImages: async () => {
      const payload: {
        path: string;
        boxes: { points: Point[]; transcription: string }[];
      }[] = [];
      for (const img of get().images) {
        const file = await annotationFileForExport(img.path);
        // Export text-carrying annotations only: leaf text/formula/table lines
        // recognized within a region. Pure layout region parents are
        // structural and have no transcription, so they're skipped — matching
        // PPOCRLabel's detection/recognition dataset purpose.
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
