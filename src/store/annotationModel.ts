import { inferAnnotationShape } from "@/lib/annotationFile";
import type { Annotation, AnnotationResult, Mode, Point } from "@/types";

export const newId = (): string => crypto.randomUUID();

export function cloneAnnotation(annotation: Annotation): Annotation {
  return {
    ...annotation,
    points: annotation.points.map((point) => [point[0], point[1]] as Point),
    results: annotation.results.map((result) => ({
      ...result,
      value: { ...result.value },
    })),
  };
}

export function currentLabel(mode: Mode, explicit?: string): string {
  if (explicit) return explicit;
  if (mode === "formula") return "formula";
  if (mode === "layout") return "layout";
  return "text";
}

export function isBulkRecognitionTarget(annotation: Annotation, mode: Mode): boolean {
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

export function manualResults(label: string): AnnotationResult[] {
  return label === "text"
    ? [
        { task: "text_detection", value: { label: "text" }, score: 1, source: "manual" },
        { task: "text_recognition", value: { text: "" }, score: 1, source: "manual" },
      ]
    : [{ task: "layout_detection", value: { label }, score: 1, source: "manual" }];
}

export function setTextResult(annotation: Annotation, text: string): Annotation {
  let found = false;
  const results = annotation.results.map((result) => {
    if (result.task !== "text_recognition") return result;
    found = true;
    const currentText = typeof result.value.text === "string" ? result.value.text : "";
    if (currentText === text && result.source === "manual") return result;
    const original =
      result.source === "manual" || typeof result.value.originalText === "string"
        ? {}
        : {
            originalText: currentText,
            originalScore: result.score,
            originalSource: result.source,
          };
    return {
      ...result,
      value: { ...result.value, ...original, text },
      score: 1,
      source: "manual" as const,
    };
  });
  return found
    ? { ...annotation, results }
    : {
        ...annotation,
        results: results.concat({
          task: "text_recognition",
          value: { text },
          score: 1,
          source: "manual",
        }),
      };
}

export function setLabelResult(annotation: Annotation, label: string): Annotation {
  let found = false;
  const results = annotation.results.map((result) => {
    if (result.task !== "layout_detection") return result;
    found = true;
    const previous = typeof result.value.label === "string" ? result.value.label : "";
    if (previous === label && result.source === "manual") return result;
    const original =
      result.source === "manual" || typeof result.value.originalLabel === "string"
        ? {}
        : {
            originalLabel: previous,
            originalScore: result.score,
            originalSource: result.source,
          };
    return {
      ...result,
      value: { ...result.value, ...original, label },
      score: 1,
      source: "manual" as const,
    };
  });
  return found
    ? { ...annotation, results }
    : {
        ...annotation,
        results: results.concat({
          task: "layout_detection",
          value: { label },
          score: 1,
          source: "manual",
        }),
      };
}

export function markGeometryManual(annotation: Annotation): Annotation {
  const results = annotation.results.map((result) => {
    if (result.task !== "text_detection" && result.task !== "layout_detection") return result;
    if (result.source === "manual" && result.score === 1) return result;
    return {
      ...result,
      value: {
        ...result.value,
        originalScore: result.value.originalScore ?? result.score,
        originalSource: result.value.originalSource ?? result.source,
      },
      score: 1,
      source: "manual" as const,
    };
  });
  return { ...annotation, results };
}

export function setAutoTextResult(
  annotation: Annotation,
  text: string,
  score: number | null,
): Annotation {
  let found = false;
  const results = annotation.results.map((result) => {
    if (result.task !== "text_recognition") return result;
    found = true;
    return { ...result, value: { ...result.value, text }, score, source: "auto" as const };
  });
  return found
    ? { ...annotation, results }
    : {
        ...annotation,
        results: results.concat({
          task: "text_recognition",
          value: { text },
          score,
          source: "auto",
        }),
      };
}

export function setAutoFormulaResult(
  annotation: Annotation,
  latex: string,
  score: number | null,
): Annotation {
  let hasLayout = false;
  let hasText = false;
  const results = annotation.results.map((result) => {
    if (result.task === "layout_detection") {
      hasLayout = true;
      return {
        ...result,
        value: { ...result.value, label: "formula" },
        score: score ?? result.score,
        source: "auto" as const,
      };
    }
    if (result.task === "text_recognition") {
      hasText = true;
      return {
        ...result,
        value: { ...result.value, text: latex, latex },
        score,
        source: "auto" as const,
      };
    }
    return result;
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
  return { ...annotation, results };
}

export function textAnnotation(points: Point[], text: string, score: number | null): Annotation {
  return {
    id: newId(),
    points,
    shape: inferAnnotationShape(points),
    results: [
      { task: "text_detection", value: { label: "text" }, score, source: "auto" },
      { task: "text_recognition", value: { text }, score, source: "auto" },
    ],
  };
}

export function layoutAnnotation(points: Point[], label: string, score: number | null): Annotation {
  return {
    id: newId(),
    points,
    shape: inferAnnotationShape(points),
    results: [{ task: "layout_detection", value: { label }, score, source: "auto" }],
  };
}

export function recognizedLayoutAnnotation(
  points: Point[],
  label: string,
  text: string,
  score: number | null,
): Annotation {
  return {
    id: newId(),
    points,
    shape: inferAnnotationShape(points),
    results: [
      { task: "layout_detection", value: { label }, score, source: "auto" },
      { task: "text_recognition", value: { text }, score, source: "auto" },
    ],
  };
}
