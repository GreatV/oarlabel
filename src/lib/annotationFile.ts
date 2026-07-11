import type {
  Annotation,
  AnnotationResult,
  AnnotationShape,
  ImageAnnotationFile,
  ImageStatus,
  Point,
} from "@/types";

const VALID_IMAGE_STATUSES: ReadonlySet<ImageStatus> = new Set([
  "pending",
  "preannotated",
  "labeling",
  "done",
]);

export interface ParsedAnnotationFile extends ImageAnnotationFile {
  /** Invalid entries omitted while preserving every valid annotation. */
  skippedAnnotations: number;
  invalidAnnotationIndices: number[];
}

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

export function inferAnnotationShape(points: Point[]): AnnotationShape {
  // Legacy files had no shape tag. Existing four-point detector boxes should
  // continue to use the rectangle editor; other point counts are polygons.
  return points.length === 4 ? "rect" : "polygon";
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
  if (
    !Array.isArray(value.points) ||
    value.points.length < 3 ||
    !value.points.every(isPoint) ||
    !Array.isArray(value.results) ||
    value.results.length === 0
  ) {
    return null;
  }
  const points = value.points;
  const normalizedResults = value.results.map(normalizeAnnotationResult);
  if (normalizedResults.some((result) => result === null)) return null;
  const results = normalizedResults as AnnotationResult[];
  return {
    id: typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
    points,
    hidden: value.hidden === true,
    shape:
      value.shape === "rect" || value.shape === "polygon"
        ? value.shape
        : inferAnnotationShape(points),
    results,
  };
}

export function parseAnnotationFile(text: string | null): ParsedAnnotationFile {
  if (!text) {
    return {
      version: 1,
      status: "pending",
      annotations: [],
      skippedAnnotations: 0,
      invalidAnnotationIndices: [],
    };
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error("Annotation file root must be an object");
  if (
    typeof parsed.status !== "string" ||
    !VALID_IMAGE_STATUSES.has(parsed.status as ImageStatus)
  ) {
    throw new Error("Annotation file has an invalid status");
  }
  if (!Array.isArray(parsed.annotations)) {
    throw new Error("Annotation file annotations must be an array");
  }
  const invalidAnnotationIndices: number[] = [];
  const annotations = parsed.annotations.flatMap((value, index) => {
    const annotation = normalizeAnnotationInput(value);
    if (!annotation) {
      invalidAnnotationIndices.push(index);
      return [];
    }
    return [annotation];
  });
  return {
    version: 1,
    status: parsed.status as ImageStatus,
    annotations,
    skippedAnnotations: invalidAnnotationIndices.length,
    invalidAnnotationIndices,
  };
}
