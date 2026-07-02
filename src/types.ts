// Shared domain types for the oarlabel frontend.

export type Mode = "ocr" | "layout" | "formula" | "table" | "reading";

export type Tool = "select" | "rect" | "polygon" | "edit" | "delete";

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

export interface AnnotationResult {
  task: string;
  value: Record<string, unknown>;
  score: number | null;
  source: AnnotationSource;
}

export interface Annotation {
  id: string;
  points: Point[];
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
