// Shared domain types for the oarlabel frontend.

export type Mode = "ocr" | "layout" | "formula";

/** UI theme. `system` follows the OS `prefers-color-scheme` setting. */
export type Theme = "light" | "dark" | "system";

export const THEME_OPTIONS: { key: Theme; labelKey: "theme.light" | "theme.dark" | "theme.system" }[] = [
  { key: "light", labelKey: "theme.light" },
  { key: "dark", labelKey: "theme.dark" },
  { key: "system", labelKey: "theme.system" },
];

export type Tool = "select" | "rect" | "polygon";

export type ImageStatus = "pending" | "preannotated" | "labeling" | "done";

export interface ImageItem {
  path: string;
  name: string;
  status: ImageStatus;
  width?: number;
  height?: number;
}

export type Point = [number, number];

export type AnnotationSource = "manual" | "auto";
export type AnnotationShape = "rect" | "polygon";

export interface AnnotationResult {
  task: string;
  value: Record<string, unknown>;
  score: number | null;
  source: AnnotationSource;
}

export interface Annotation {
  id: string;
  points: Point[];
  /** Hidden from the canvas only. Export and persistence keep the annotation. */
  hidden?: boolean;
  /** Stable editing shape. Old files may not carry this; the loader normalizes
   *  it so render/edit code does not have to infer shape on every frame. */
  shape?: AnnotationShape;
  results: AnnotationResult[];
  /** Parent region id for a child annotation produced by the structured
   *  pipeline, or null/undefined for a top-level (region or manual) box.
   *  Optional so v1 on-disk files (which never carried it) load fine as
   *  top-level annotations. */
  parentId?: string | null;
}

export interface ImageAnnotationFile {
  version: 1;
  status: ImageStatus;
  annotations: Annotation[];
}

export interface PreannBox {
  points: Point[];
  text: string | null;
  label: string | null;
  score: number | null;
  /** Reading-order position (0-based), when the active pipeline can provide or compute it. */
  order?: number | null;
  /** Stable region id (snake_case on the wire from Rust serde). Only set by
   *  the structured pipeline on layout-detected region boxes, so children can
   *  reference them via `parent_id`. */
  id?: string | null;
  /** Parent region id (snake_case on the wire). Only set by children produced
   *  inside the structured pipeline. Mapped to `Annotation.parentId`. */
  parent_id?: string | null;
}

/** Result of a pre-annotation pass: successful boxes plus a count of regions
 *  that failed (crop/recognize) and were skipped. `skipped` is 0 for OCR and
 *  plain layout runs. */
export interface PreannResult {
  boxes: PreannBox[];
  skipped: number;
}

export interface TextRegionInput {
  id: string;
  points: Point[];
}

export interface RecognizedTextRegion {
  id: string;
  text: string;
  score: number | null;
}

export interface TextRecognitionRegionResult {
  regions: RecognizedTextRegion[];
  skipped: number;
}

export interface ModelStatus {
  key: string;
  filename: string;
  title: string;
  size_label: string;
  bundled: boolean;
  present: boolean;
  kind: string;
}

export interface ModelOption {
  key: string;
  title: string;
}

export interface ModelOptions {
  ocr_profiles: ModelOption[];
  layout_models: ModelOption[];
  formula_profiles: ModelOption[];
  table_profiles: ModelOption[];
}

export interface CustomOcrPaths {
  textDetectionModelPath: string;
  textRecognitionModelPath: string;
  textRecognitionDictPath: string;
}

export interface TextDetectionTuning {
  score_threshold?: number;
  box_threshold?: number;
  unclip_ratio?: number;
}

export interface TextRecognitionTuning {
  score_threshold?: number;
}

export interface LayoutDetectionTuning {
  score_threshold?: number;
  nms_threshold?: number;
  max_elements?: number;
}

export interface InferenceTuning {
  ocr?: TextDetectionTuning;
  text_recognition?: TextRecognitionTuning;
  layout?: LayoutDetectionTuning;
}

export type Device = "auto" | "cpu" | "cuda";

export interface ViewOptions {
  fileList: boolean;
  results: boolean;
  toolbar: boolean;
  statusBar: boolean;
  boxes: boolean;
  labels: boolean;
  highlight: boolean;
}

// Single source of truth for the view-toggle keys. Used by the store
// (DEFAULT_VIEW), useNativeMenu (macOS checkbox sync), and mirrored in
// src-tauri/src/menu.rs. If you add a flag here, update all three.
export const VIEW_KEYS: (keyof ViewOptions)[] = [
  "fileList",
  "results",
  "toolbar",
  "statusBar",
  "boxes",
  "labels",
  "highlight",
];

export type FitMode = "window" | "width" | "actual";

export const DEVICE_OPTIONS: { key: Device; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "cpu", label: "CPU" },
  { key: "cuda", label: "CUDA" },
];

export function resultText(a: Annotation): string {
  const text = a.results.find((r) => r.task === "text_recognition")?.value.text;
  return typeof text === "string" ? text : "";
}

/** Reading-order index, if the annotation carries one. */
export function resultReadingIndex(a: Annotation): number | undefined {
  const idx = a.results.find((r) => r.task === "reading_order")?.value.index;
  return typeof idx === "number" ? idx : undefined;
}

export function resultLabel(a: Annotation): string | undefined {
  for (const task of ["layout_detection", "text_detection"]) {
    const label = a.results.find((r) => r.task === task)?.value.label;
    if (typeof label === "string") return label;
  }
  return undefined;
}

export function resultScore(a: Annotation): number | undefined {
  const result =
    a.results.find((r) => r.task === "layout_detection") ??
    a.results.find((r) => r.task === "text_recognition") ??
    a.results.find((r) => r.task === "text_detection");
  return typeof result?.score === "number" ? result.score : undefined;
}
