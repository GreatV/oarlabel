import type { StateCreator } from "zustand";
import { t, type Locale } from "@/i18n";
import { api } from "@/lib/tauri";
import { loadJson, saveJson } from "@/lib/storage";
import type { Device, InferenceTuning, Theme, ViewOptions } from "@/types";
import type { AppState, SettingsSlice } from "@/store/types";

export const STORAGE_KEYS = {
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

export const DEFAULT_VIEW: ViewOptions = {
  fileList: true,
  results: true,
  toolbar: true,
  statusBar: true,
  boxes: true,
  labels: true,
  highlight: true,
};

const MAX_RECENT = 8;
const DEFAULT_MIN_BOX_SIZE = 4;
const DEFAULT_INFERENCE_TUNING: Required<InferenceTuning> = {
  ocr: { score_threshold: 0.2, box_threshold: 0.45, unclip_ratio: 1.4 },
  text_recognition: { score_threshold: 0 },
  layout: { score_threshold: 0.5, nms_threshold: 0.5, max_elements: 100 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeViewOptions(value: unknown): ViewOptions {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_VIEW).map(([key, fallback]) => [
      key,
      typeof source[key] === "boolean" ? source[key] : fallback,
    ]),
  ) as unknown as ViewOptions;
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

function normalizeDevice(value: unknown): Device {
  return value === "cpu" || value === "cuda" ? value : "cpu";
}

function normalizeTheme(value: unknown): Theme {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function normalizeMinBoxSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MIN_BOX_SIZE;
  return Math.min(128, Math.max(1, Math.round(value)));
}

export function normalizeInferenceTuning(value: unknown): Required<InferenceTuning> {
  const source = isRecord(value) ? value : {};
  const ocr = isRecord(source.ocr) ? source.ocr : {};
  const textRecognition = isRecord(source.text_recognition) ? source.text_recognition : {};
  const layout = isRecord(source.layout) ? source.layout : {};
  return {
    ocr: {
      score_threshold: clampNumber(ocr.score_threshold, 0.2, 0, 1),
      box_threshold: clampNumber(ocr.box_threshold, 0.45, 0, 1),
      unclip_ratio: clampNumber(ocr.unclip_ratio, 1.4, 0, 10),
    },
    text_recognition: {
      score_threshold: clampNumber(textRecognition.score_threshold, 0, 0, 1),
    },
    layout: {
      score_threshold: clampNumber(layout.score_threshold, 0.5, 0, 1),
      nms_threshold: clampNumber(layout.nms_threshold, 0.5, 0, 1),
      max_elements: Math.round(clampNumber(layout.max_elements, 100, 1, 1000)),
    },
  };
}

function storedString(key: string, fallback: string): string {
  const value = loadJson<unknown>(key, null);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set, get) => ({
  modelOptions: null,
  deviceOptions: [],
  view: normalizeViewOptions(loadJson<unknown>(STORAGE_KEYS.view, DEFAULT_VIEW)),
  ocrModel: storedString(STORAGE_KEYS.ocrModel, "ppocrv6_tiny"),
  layoutModel: storedString(STORAGE_KEYS.layoutModel, "layout_doc_v3"),
  formulaModel: storedString(STORAGE_KEYS.formulaModel, "pp_formulanet_plus_s"),
  device: normalizeDevice(loadJson<unknown>(STORAGE_KEYS.device, "cpu")),
  locale: normalizeStoredLocale(loadJson<unknown>(STORAGE_KEYS.locale, "zh-CN")),
  theme: normalizeTheme(loadJson<unknown>(STORAGE_KEYS.theme, "system")),
  recentDirs: normalizeRecentDirs(loadJson<unknown>(STORAGE_KEYS.recentDirs, [])),
  minBoxSize: normalizeMinBoxSize(
    loadJson<unknown>(STORAGE_KEYS.minBoxSize, DEFAULT_MIN_BOX_SIZE),
  ),
  inferenceTuning: normalizeInferenceTuning(
    loadJson<unknown>(STORAGE_KEYS.inferenceTuning, DEFAULT_INFERENCE_TUNING),
  ),
  autoSave: loadJson<unknown>(STORAGE_KEYS.autoSave, false) === true,

  toggleView: (key) =>
    set((state) => {
      const view = { ...state.view, [key]: !state.view[key] };
      saveJson(STORAGE_KEYS.view, view);
      return { view };
    }),
  resetLayout: () => {
    saveJson(STORAGE_KEYS.view, DEFAULT_VIEW);
    set({ view: { ...DEFAULT_VIEW } });
    get().requestFit("window");
  },
  setOcrModel: (key) => {
    saveJson(STORAGE_KEYS.ocrModel, key);
    set({ ocrModel: key });
  },
  setLayoutModel: (key) => {
    saveJson(STORAGE_KEYS.layoutModel, key);
    set({ layoutModel: key });
  },
  setFormulaModel: (key) => {
    saveJson(STORAGE_KEYS.formulaModel, key);
    set({ formulaModel: key });
  },
  setDevice: (device) => {
    const next = normalizeDevice(device);
    saveJson(STORAGE_KEYS.device, next);
    set({ device: next });
  },
  setLocale: (locale) => {
    saveJson(STORAGE_KEYS.locale, locale);
    set({ locale });
  },
  setTheme: (theme) => {
    const next = normalizeTheme(theme);
    saveJson(STORAGE_KEYS.theme, next);
    set({ theme: next });
  },
  setMinBoxSize: (size) => {
    const next = normalizeMinBoxSize(size);
    saveJson(STORAGE_KEYS.minBoxSize, next);
    set({ minBoxSize: next });
  },
  setInferenceTuning: (tuning) => {
    const next = normalizeInferenceTuning(tuning);
    saveJson(STORAGE_KEYS.inferenceTuning, next);
    set({ inferenceTuning: next });
  },
  setAutoSave: (enabled) => {
    saveJson(STORAGE_KEYS.autoSave, enabled);
    set({ autoSave: enabled });
  },
  refreshModels: async () => {
    try {
      const [modelOptions, deviceOptions] = await Promise.all([
        api.modelOptions(),
        api.availableDevices(),
      ]);
      const next: Partial<AppState> = { modelOptions, deviceOptions };
      const state = get();
      if (!modelOptions.ocr_profiles.some((option) => option.key === state.ocrModel)) {
        next.ocrModel = modelOptions.ocr_profiles[0]?.key ?? state.ocrModel;
      }
      if (!modelOptions.layout_models.some((option) => option.key === state.layoutModel)) {
        next.layoutModel = modelOptions.layout_models[0]?.key ?? state.layoutModel;
      }
      if (!modelOptions.formula_profiles.some((option) => option.key === state.formulaModel)) {
        next.formulaModel = modelOptions.formula_profiles[0]?.key ?? state.formulaModel;
      }
      if (!deviceOptions.some((option) => option.key === state.device)) {
        next.device = deviceOptions[0]?.key ?? state.device;
      }
      if (next.ocrModel) saveJson(STORAGE_KEYS.ocrModel, next.ocrModel);
      if (next.layoutModel) saveJson(STORAGE_KEYS.layoutModel, next.layoutModel);
      if (next.formulaModel) saveJson(STORAGE_KEYS.formulaModel, next.formulaModel);
      if (next.device) saveJson(STORAGE_KEYS.device, next.device);
      set(next);
    } catch (error) {
      set({ statusMsg: `${t(get().locale, "message.modelConfigLoadFailed")}: ${String(error)}` });
    }
  },
});
