// Shared domain types for the oarlabel frontend.

export type Mode = "ocr" | "layout" | "formula";
export type ExportKind = "detection" | "recognition" | "formula" | "layout";

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
  /** Derived while opening the workspace so batch actions can detect saved
   * annotations even when a sidecar still reports `status: "pending"`. */
  hasAnnotations?: boolean;
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
}

/** Result of a pre-annotation pass: usable boxes plus a count of regions that
 *  failed recognition, were skipped, or returned no OCR text. */
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

export interface ModelOption {
  key: string;
  title: string;
}

export interface ModelOptions {
  ocr_profiles: ModelOption[];
  layout_models: ModelOption[];
  formula_profiles: ModelOption[];
}

export interface CustomOcrPaths {
  textDetectionModelPath: string;
  textRecognitionModelPath: string;
  textRecognitionDictPath: string;
}

export const CUSTOM_OCR_PROFILE_KEY = "custom_text_ocr";

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

export type Device = "cpu" | "cuda";

export interface DeviceOption {
  key: Device;
  label: string;
}

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

export const DEFAULT_DEVICE_OPTIONS: DeviceOption[] = [{ key: "cpu", label: "CPU" }];

export function resultText(a: Annotation): string {
  const text = a.results.find((r) => r.task === "text_recognition")?.value.text;
  return typeof text === "string" ? text : "";
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
