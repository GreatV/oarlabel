import type {
  Annotation,
  AnnotationShape,
  Device,
  DeviceOption,
  ExportKind,
  FitMode,
  ImageItem,
  ImageStatus,
  InferenceTuning,
  Mode,
  ModelOptions,
  Point,
  Theme,
  Tool,
  ViewOptions,
} from "@/types";
import type { Locale } from "@/i18n";
import type { ParsedAnnotationFile } from "@/lib/annotationFile";

export interface HistorySnapshot {
  annotations: Annotation[];
  status: ImageStatus;
  dirty: boolean;
}

export interface WorkspaceSlice {
  dir: string | null;
  images: ImageItem[];
  currentIndex: number;
  annotationErrors: Record<string, string>;
  busy: boolean;
  statusMsg: string;
  dirty: boolean;
  dirtyPaths: Record<string, boolean>;
  currentImage: () => ImageItem | null;
  currentAnnos: () => Annotation[];
  openFolder: (dir: string) => Promise<void>;
  openFiles: (paths: string[]) => Promise<void>;
  selectIndex: (index: number) => Promise<void>;
  next: () => void;
  prev: () => void;
}

export interface AnnotationSlice {
  annos: Record<string, Annotation[]>;
  selectedIds: string[];
  selectedId: string | null;
  clipboard: Annotation[];
  mode: Mode;
  tool: Tool;
  zoom: number;
  fitMode: FitMode | null;
  fitNonce: number;
  past: Record<string, HistorySnapshot[]>;
  future: Record<string, HistorySnapshot[]>;
  setMode: (mode: Mode) => void;
  setTool: (tool: Tool) => void;
  setZoom: (zoom: number) => void;
  requestFit: (mode: FitMode) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  addAnnotation: (points: Point[], label?: string, shape?: AnnotationShape) => void;
  updateAnnotationPoints: (id: string, points: Point[]) => void;
  updateAnnotationsPoints: (updates: Record<string, Point[]>) => void;
  setText: (id: string, text: string) => void;
  ensureTextResult: (id: string) => void;
  setAnnotationHidden: (id: string, hidden: boolean) => void;
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
}

export interface SettingsSlice {
  modelOptions: ModelOptions | null;
  deviceOptions: DeviceOption[];
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
  refreshModels: () => Promise<void>;
}

export interface BatchSlice {
  batchRunning: boolean;
  batchPhase: "infer" | null;
  batchTotal: number;
  batchDone: number;
  batchFailures: string[];
  batchCancelRequested: boolean;
  batchActivePath: string | null;
  batchPendingPaths: Record<string, true>;
  preannotateCurrent: () => Promise<void>;
  preannotateAll: (options?: {
    skipAnnotated?: boolean;
    replacementConfirmed?: boolean;
  }) => Promise<void>;
  requestBatchCancel: () => void;
  clearBatchFailures: () => void;
  save: () => Promise<boolean>;
  saveAndNext: () => Promise<void>;
}

export interface ExportSlice {
  exportRunning: boolean;
  exportTotal: number;
  exportDone: number;
  exportCancelRequested: boolean;
  exportSourceFailures: string[];
  exportSourceSkipped: number;
  exportableImages: (kind: ExportKind) => Promise<
    {
      path: string;
      boxes: { points: Point[]; transcription: string; label?: string }[];
    }[] | null
  >;
  requestExportCancel: () => void;
}

export type AppState = WorkspaceSlice &
  AnnotationSlice &
  SettingsSlice &
  BatchSlice &
  ExportSlice;

export interface PreannParams {
  mode: Mode;
  ocrModel: string;
  layoutModel: string;
  formulaModel: string;
  device: Device;
  thresholds: InferenceTuning | null;
}

export interface StoreRuntime {
  beginLoad: () => number;
  isCurrentLoad: (token: number) => boolean;
  canDiscardDirty: () => Promise<boolean>;
  loadImageList: (
    raw: Omit<ImageItem, "status">[],
    dir: string | null,
    label: string,
    token: number,
  ) => Promise<void>;
  pushRecent: (dir: string) => void;
  prepareCurrentImageForSwitch: (targetIndex: number) => Promise<boolean>;
  loadImageFile: (path: string) => Promise<ParsedAnnotationFile>;
  recordAnnotationIssues: (path: string, file: ParsedAnnotationFile) => string | null;
  retainRecentCleanImages: (path: string) => void;
  mutate: (
    producer: (previous: Annotation[]) => Annotation[],
    options?: { allowDuringBusy?: boolean; preserveStatus?: boolean },
  ) => boolean;
  recognizeTextForAnnotations: (annotations: Annotation[]) => Promise<void>;
  recognizeFormulaForAnnotations: (annotations: Annotation[]) => Promise<void>;
  snapshotPreannParams: () => PreannParams;
  runPreannotation: (
    path: string,
    params?: PreannParams,
  ) => Promise<{ annos: Annotation[]; skipped: number }>;
  applyPreannotation: (path: string, annotations: Annotation[]) => void;
  saveImageAfterBatchPreannotation: (path: string) => Promise<void>;
  saveCurrentImage: (status?: ImageStatus) => Promise<boolean>;
  annotationFileForExport: (path: string) => Promise<ParsedAnnotationFile>;
}
