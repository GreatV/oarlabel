import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation, ImageItem } from "@/types";

const mocks = vi.hoisted(() => ({
  askSaveAndCompleteCurrent: vi.fn(),
  confirmDiscardChanges: vi.fn(),
  confirmReplaceAnnotations: vi.fn(),
  confirmReplaceBatchAnnotations: vi.fn(),
  readAnnotation: vi.fn(),
  saveAnnotation: vi.fn(),
  preannotate: vi.fn(),
  cancelPreannotation: vi.fn(),
  recognizeTextRegions: vi.fn(),
  recognizeFormulaRegions: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  askSaveAndCompleteCurrent: mocks.askSaveAndCompleteCurrent,
  confirmDiscardChanges: mocks.confirmDiscardChanges,
  confirmReplaceAnnotations: mocks.confirmReplaceAnnotations,
  confirmReplaceBatchAnnotations: mocks.confirmReplaceBatchAnnotations,
  api: {
    readAnnotation: mocks.readAnnotation,
    saveAnnotation: mocks.saveAnnotation,
    preannotate: mocks.preannotate,
    cancelPreannotation: mocks.cancelPreannotation,
    recognizeTextRegions: mocks.recognizeTextRegions,
    recognizeFormulaRegions: mocks.recognizeFormulaRegions,
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});

const {
  normalizeInferenceTuning,
  normalizeRecentDirs,
  normalizeStoredLocale,
  normalizeViewOptions,
  useStore,
} = await import("@/store");

const annotation: Annotation = {
  id: "box-1",
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  shape: "rect",
  results: [
    {
      task: "text_recognition",
      value: { text: "hello" },
      score: 1,
      source: "manual",
    },
  ],
};

const images: ImageItem[] = [
  { path: "/images/a.png", name: "a.png", status: "labeling" },
  { path: "/images/b.png", name: "b.png", status: "preannotated" },
];

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  mocks.readAnnotation.mockResolvedValue(null);
  mocks.saveAnnotation.mockResolvedValue(undefined);
  mocks.preannotate.mockResolvedValue({ boxes: [], skipped: 0 });
  mocks.cancelPreannotation.mockResolvedValue(undefined);
  mocks.recognizeTextRegions.mockResolvedValue({ regions: [], skipped: 0 });
  mocks.recognizeFormulaRegions.mockResolvedValue({ regions: [], skipped: 0 });
  mocks.askSaveAndCompleteCurrent.mockResolvedValue(false);
  mocks.confirmDiscardChanges.mockResolvedValue(true);
  mocks.confirmReplaceAnnotations.mockResolvedValue(true);
  mocks.confirmReplaceBatchAnnotations.mockResolvedValue(true);
  useStore.setState({
    images,
    currentIndex: 0,
    annos: {
      [images[0].path]: [annotation],
      [images[1].path]: [annotation],
    },
    dirty: false,
    dirtyPaths: {},
    busy: false,
    batchRunning: false,
    batchCancelRequested: false,
    exportRunning: false,
    exportTotal: 0,
    exportDone: 0,
    exportCancelRequested: false,
    selectedIds: [],
    selectedId: null,
    clipboard: [],
    past: {},
    future: {},
    autoSave: false,
    mode: "ocr",
    locale: "zh-CN",
  });
});

describe("stored preference normalization", () => {
  it("falls back safely for malformed locale and view values", () => {
    expect(normalizeStoredLocale("fr-FR")).toBe("zh-CN");
    expect(normalizeViewOptions({ fileList: false, toolbar: "invalid" })).toMatchObject({
      fileList: false,
      toolbar: true,
      results: true,
    });
  });

  it("filters and bounds malformed recent-directory values", () => {
    expect(normalizeRecentDirs("not-an-array")).toEqual([]);
    expect(
      normalizeRecentDirs(["/a", 1, "", "/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i"]),
    ).toEqual(["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"]);
  });

  it("restores bounded inference defaults from invalid persisted data", () => {
    expect(normalizeInferenceTuning(null)).toMatchObject({
      ocr: { score_threshold: 0.2, box_threshold: 0.45, unclip_ratio: 1.4 },
      layout: { score_threshold: 0.5, nms_threshold: 0.5, max_elements: 100 },
    });
    expect(
      normalizeInferenceTuning({
        ocr: { score_threshold: 4, unclip_ratio: -2 },
        layout: { max_elements: 5000 },
      }),
    ).toMatchObject({
      ocr: { score_threshold: 1, unclip_ratio: 0 },
      layout: { max_elements: 1000 },
    });
  });
});

describe("annotation persistence", () => {
  it("saves only the currently displayed image", async () => {
    useStore.setState({
      dirty: true,
      dirtyPaths: {
        [images[0].path]: true,
        [images[1].path]: true,
      },
    });

    await expect(useStore.getState().save()).resolves.toBe(true);

    expect(mocks.saveAnnotation).toHaveBeenCalledOnce();
    expect(mocks.saveAnnotation).toHaveBeenCalledWith(
      images[0].path,
      expect.any(String),
    );
    expect(useStore.getState().dirtyPaths).toEqual({ [images[1].path]: true });
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().statusMsg).toBe("当前图片已保存");
    expect(useStore.getState().images.map((image) => image.status)).toEqual([
      "labeling",
      "preannotated",
    ]);
  });

  it("keeps all dirty state when saving the current image fails", async () => {
    mocks.saveAnnotation.mockRejectedValue(new Error("disk full"));
    useStore.setState({
      dirty: true,
      dirtyPaths: {
        [images[0].path]: true,
        [images[1].path]: true,
      },
    });

    await expect(useStore.getState().save()).resolves.toBe(false);

    expect(mocks.saveAnnotation).toHaveBeenCalledOnce();
    expect(useStore.getState().dirtyPaths).toEqual({
      [images[0].path]: true,
      [images[1].path]: true,
    });
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().statusMsg).toContain("disk full");
  });

  it("does not repeatedly save or prompt for an unchanged image in auto-save mode", async () => {
    useStore.setState({ autoSave: true });

    await useStore.getState().selectIndex(1);

    expect(mocks.saveAnnotation).not.toHaveBeenCalled();
    expect(mocks.askSaveAndCompleteCurrent).not.toHaveBeenCalled();
    expect(useStore.getState().currentIndex).toBe(1);
  });

  it("blocks annotation edits and image switches while an operation is running", async () => {
    useStore.setState({ busy: true });

    useStore.getState().setText(annotation.id, "overwritten");
    await useStore.getState().selectIndex(1);

    expect(useStore.getState().currentIndex).toBe(0);
    expect(useStore.getState().currentAnnos()[0].results[0].value.text).toBe("hello");
    expect(useStore.getState().dirty).toBe(false);
  });

  it("save-and-next completes only the current image", async () => {
    useStore.setState({
      dirty: true,
      dirtyPaths: { [images[0].path]: true },
    });

    await useStore.getState().saveAndNext();

    expect(useStore.getState().currentIndex).toBe(1);
    expect(useStore.getState().images.map((image) => image.status)).toEqual([
      "done",
      "preannotated",
    ]);
    const saved = JSON.parse(mocks.saveAnnotation.mock.calls[0][1] as string);
    expect(saved.status).toBe("done");
  });

  it("reopens only the current completed image when it is edited", () => {
    useStore.setState({
      images: [
        { ...images[0], status: "done" },
        { ...images[1], status: "done" },
      ],
    });

    useStore.getState().setText(annotation.id, "corrected");

    expect(useStore.getState().images.map((image) => image.status)).toEqual([
      "labeling",
      "done",
    ]);
  });
});

describe("annotation state invariants", () => {
  it("does not create dangling pasted selections while busy", () => {
    useStore.setState({
      busy: true,
      clipboard: [annotation],
      selectedIds: [],
      selectedId: null,
    });

    useStore.getState().paste();

    expect(useStore.getState().currentAnnos()).toEqual([annotation]);
    expect(useStore.getState().selectedIds).toEqual([]);
    expect(useStore.getState().selectedId).toBeNull();
  });

  it("drops selections that no longer exist after undo", () => {
    useStore.setState({
      images: [{ ...images[0], status: "done" }, images[1]],
      annos: { [images[0].path]: [annotation] },
      past: {
        [images[0].path]: [{ annotations: [], status: "preannotated" }],
      },
      selectedIds: [annotation.id],
      selectedId: annotation.id,
    });

    useStore.getState().undo();

    expect(useStore.getState().currentAnnos()).toEqual([]);
    expect(useStore.getState().selectedIds).toEqual([]);
    expect(useStore.getState().selectedId).toBeNull();
    expect(useStore.getState().images[0].status).toBe("preannotated");
  });

  it("restores done status on undo and labeling status on redo", () => {
    useStore.setState({
      images: [{ ...images[0], status: "done" }, images[1]],
    });

    useStore.getState().setText(annotation.id, "corrected");
    expect(useStore.getState().images[0].status).toBe("labeling");

    useStore.getState().undo();
    expect(useStore.getState().images[0].status).toBe("done");
    expect(useStore.getState().currentAnnos()[0].results[0].value.text).toBe("hello");

    useStore.getState().redo();
    expect(useStore.getState().images[0].status).toBe("labeling");
    expect(useStore.getState().currentAnnos()[0].results[0].value.text).toBe("corrected");
  });
});

describe("recognition regions", () => {
  it("sends manually adjusted points to text recognition", async () => {
    const adjustedPoints: Annotation["points"] = [
      [20, 30],
      [80, 30],
      [80, 55],
      [20, 55],
    ];
    useStore.setState({
      selectedIds: [annotation.id],
      selectedId: annotation.id,
    });

    useStore.getState().updateAnnotationPoints(annotation.id, adjustedPoints);
    await useStore.getState().recognizeSelectedText();

    expect(mocks.recognizeTextRegions).toHaveBeenCalledOnce();
    expect(mocks.recognizeTextRegions.mock.calls[0][3]).toEqual([
      { id: annotation.id, points: adjustedPoints },
    ]);
  });

  it("uses locale-appropriate separators for skipped regions", async () => {
    useStore.setState({
      selectedIds: [annotation.id],
      selectedId: annotation.id,
    });
    mocks.recognizeTextRegions.mockResolvedValue({ regions: [], skipped: 1 });

    await useStore.getState().recognizeSelectedText();
    expect(useStore.getState().statusMsg).toContain("，1 个区域");

    useStore.setState({ locale: "en-US", mode: "formula" });
    mocks.recognizeFormulaRegions.mockResolvedValue({ regions: [], skipped: 1 });
    await useStore.getState().recognizeSelectedText();
    expect(useStore.getState().statusMsg).toContain(", 1 region(s)");
  });

  it("bulk OCR only sends visible text-detection annotations", async () => {
    const textLeaf: Annotation = {
      ...annotation,
      id: "text-leaf",
      results: [
        {
          task: "text_detection",
          value: { label: "text" },
          score: 0.9,
          source: "auto",
        },
        ...annotation.results,
      ],
    };
    const layoutRegion: Annotation = {
      ...annotation,
      id: "layout-region",
      results: [
        {
          task: "layout_detection",
          value: { label: "title" },
          score: 0.8,
          source: "auto",
        },
      ],
    };
    const formulaRegion: Annotation = {
      ...annotation,
      id: "formula-region",
      results: [
        {
          task: "layout_detection",
          value: { label: "formula" },
          score: 0.8,
          source: "auto",
        },
        ...annotation.results,
      ],
    };
    const hiddenText: Annotation = { ...textLeaf, id: "hidden-text", hidden: true };
    useStore.setState({
      mode: "ocr",
      annos: {
        [images[0].path]: [textLeaf, layoutRegion, formulaRegion, hiddenText],
      },
    });

    await useStore.getState().recognizeAllTextBoxes();

    expect(mocks.recognizeTextRegions).toHaveBeenCalledOnce();
    expect(mocks.recognizeTextRegions.mock.calls[0][3]).toEqual([
      { id: textLeaf.id, points: textLeaf.points },
    ]);
  });

  it("bulk formula recognition only updates visible formula annotations", async () => {
    const textLeaf: Annotation = {
      ...annotation,
      id: "text-leaf",
      results: [
        {
          task: "text_detection",
          value: { label: "text" },
          score: 0.9,
          source: "auto",
        },
        ...annotation.results,
      ],
    };
    const formulaRegion: Annotation = {
      ...annotation,
      id: "formula-region",
      results: [
        {
          task: "layout_detection",
          value: { label: "formula" },
          score: 0.8,
          source: "auto",
        },
        ...annotation.results,
      ],
    };
    const hiddenFormula: Annotation = {
      ...formulaRegion,
      id: "hidden-formula",
      hidden: true,
    };
    useStore.setState({
      mode: "formula",
      annos: {
        [images[0].path]: [textLeaf, formulaRegion, hiddenFormula],
      },
    });
    mocks.recognizeFormulaRegions.mockResolvedValue({
      regions: [{ id: formulaRegion.id, text: "x^2", score: 0.95 }],
      skipped: 0,
    });

    await useStore.getState().recognizeAllTextBoxes();

    expect(mocks.recognizeFormulaRegions).toHaveBeenCalledOnce();
    expect(mocks.recognizeFormulaRegions.mock.calls[0][3]).toEqual([
      { id: formulaRegion.id, points: formulaRegion.points },
    ]);
    const current = useStore.getState().currentAnnos();
    expect(current.find((item) => item.id === textLeaf.id)).toEqual(textLeaf);
    expect(current.find((item) => item.id === hiddenFormula.id)).toEqual(hiddenFormula);
    expect(
      current
        .find((item) => item.id === formulaRegion.id)
        ?.results.find((result) => result.task === "text_recognition")?.value.text,
    ).toBe("x^2");
  });
});

describe("pre-annotation settings", () => {
  it("localizes the mode name in missing-result errors", async () => {
    useStore.setState({ mode: "formula", locale: "zh-CN" });
    mocks.preannotate.mockResolvedValue({
      boxes: [{ points: annotation.points, text: null, label: "formula", score: 0.9 }],
      skipped: 0,
    });

    await useStore.getState().preannotateCurrent();

    expect(useStore.getState().statusMsg).toContain("公式 结果缺少识别文本");
    expect(useStore.getState().statusMsg).not.toContain("formula 结果");
  });

  it("restores the previous status when pre-annotation is undone", async () => {
    useStore.setState({
      images: [{ ...images[0], status: "pending" }, images[1]],
    });
    mocks.preannotate.mockResolvedValue({
      boxes: [
        {
          points: [
            [20, 20],
            [40, 20],
            [40, 40],
            [20, 40],
          ],
          text: "new",
          label: null,
          score: 0.9,
        },
      ],
      skipped: 0,
    });

    await useStore.getState().preannotateCurrent();
    expect(useStore.getState().images[0].status).toBe("preannotated");
    expect(useStore.getState().currentAnnos()[0].results[1].value.text).toBe("new");

    useStore.getState().undo();
    expect(useStore.getState().images[0].status).toBe("pending");
    expect(useStore.getState().currentAnnos()).toEqual([annotation]);

    useStore.getState().redo();
    expect(useStore.getState().images[0].status).toBe("preannotated");
    expect(useStore.getState().currentAnnos()[0].results[1].value.text).toBe("new");
  });

  it("passes layout tuning to pre-annotation requests", async () => {
    useStore.setState({
      images: [{ ...images[0], status: "done" }, images[1]],
      annos: { [images[0].path]: [] },
      selectedIds: [annotation.id],
      selectedId: annotation.id,
      inferenceTuning: {
        ocr: { score_threshold: 0.2, box_threshold: 0.45, unclip_ratio: 1.4 },
        text_recognition: { score_threshold: 0.1 },
        layout: { score_threshold: 0.67, nms_threshold: 0.38, max_elements: 42 },
      },
    });

    await useStore.getState().preannotateCurrent();

    expect(mocks.preannotate).toHaveBeenCalledOnce();
    expect(mocks.preannotate.mock.calls[0][6]).toMatchObject({
      layout: { score_threshold: 0.67, nms_threshold: 0.38, max_elements: 42 },
    });
    expect(useStore.getState().selectedIds).toEqual([]);
    expect(useStore.getState().selectedId).toBeNull();
    expect(useStore.getState().images.map((image) => image.status)).toEqual([
      "preannotated",
      "preannotated",
    ]);
  });

  it("logs every batch pre-annotation failure with its image name", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.preannotate.mockRejectedValue(new Error("model failure"));

    try {
      await useStore.getState().preannotateAll();

      expect(errorLog).toHaveBeenCalledOnce();
      const detail = String(errorLog.mock.calls[0][0]);
      expect(detail).toContain("a.png: Error: model failure");
      expect(detail).toContain("b.png: Error: model failure");
    } finally {
      errorLog.mockRestore();
    }
  });

  it("releases saved non-current batch annotations and history", async () => {
    await useStore.getState().preannotateAll();

    const state = useStore.getState();
    expect(mocks.saveAnnotation).toHaveBeenCalledTimes(2);
    expect(state.annos[images[0].path]).toBeDefined();
    expect(state.annos[images[1].path]).toBeUndefined();
    expect(state.past[images[1].path]).toBeUndefined();
    expect(state.future[images[1].path]).toBeUndefined();
  });

  it("can cancel while inspecting a batch before inference starts", async () => {
    let finishRead: (value: null) => void = () => undefined;
    mocks.readAnnotation.mockImplementation(
      () => new Promise<null>((resolve) => {
        finishRead = resolve;
      }),
    );
    useStore.setState({ annos: {} });

    const run = useStore.getState().preannotateAll();
    expect(useStore.getState().batchRunning).toBe(true);
    useStore.getState().requestBatchCancel();
    finishRead(null);
    await run;

    expect(mocks.cancelPreannotation).toHaveBeenCalledOnce();
    expect(mocks.preannotate).not.toHaveBeenCalled();
    expect(useStore.getState().batchRunning).toBe(false);
    expect(useStore.getState().annos).toEqual({});
    expect(useStore.getState().statusMsg).toContain("已取消批量预标注");
  });
});

describe("export collection", () => {
  it("reads sidecars concurrently and supports cancellation", async () => {
    const resolvers: Array<(value: string) => void> = [];
    mocks.readAnnotation.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    useStore.setState({ annos: {} });

    const run = useStore.getState().exportableImages();
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    expect(useStore.getState()).toMatchObject({
      exportRunning: true,
      exportTotal: 2,
      exportDone: 0,
    });

    useStore.getState().requestExportCancel();
    const sidecar = JSON.stringify({
      version: 1,
      status: "labeling",
      annotations: [annotation],
    });
    for (const resolve of resolvers) resolve(sidecar);

    await expect(run).resolves.toBeNull();
    expect(useStore.getState().exportRunning).toBe(false);
    expect(useStore.getState().exportCancelRequested).toBe(true);
  });
});
