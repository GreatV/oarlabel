// Typed wrappers around the Tauri command/event/asset APIs.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, confirm, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, tt, type Locale } from "@/i18n";
import type {
  CustomOcrPaths,
  DeviceOption,
  ExportKind,
  ImageItem,
  InferenceTuning,
  ModelOptions,
  PreannResult,
  TextRecognitionRegionResult,
  TextRegionInput,
  Mode,
} from "@/types";

export function fileSrc(path: string): string {
  return convertFileSrc(path, "workspace");
}

export interface ExportDatasetResult {
  path: string;
  skipped: number;
}

export interface DroppedPaths {
  directories: string[];
  images: string[];
}

export async function pickFile(title: string, extensions?: string[]): Promise<string | null> {
  const res = await open({
    multiple: false,
    title,
    filters: extensions ? [{ name: "File", extensions }] : undefined,
  });
  return typeof res === "string" ? res : null;
}

export function confirmDiscardChanges(locale: Locale): Promise<boolean> {
  return confirm(
    t(locale, "confirm.discardChanges.message"),
    { title: t(locale, "confirm.discardChanges.title"), kind: "warning" },
  );
}

export function confirmReplaceAnnotations(locale: Locale, count: number): Promise<boolean> {
  return confirm(
    tt(locale, "confirm.replaceAnnotations.message", { count }),
    { title: t(locale, "confirm.replaceAnnotations.title"), kind: "warning" },
  );
}

export function confirmReplaceBatchAnnotations(
  locale: Locale,
): Promise<boolean> {
  return confirm(
    t(locale, "confirm.replaceBatchAnnotations.message"),
    { title: t(locale, "confirm.replaceAnnotations.title"), kind: "warning" },
  );
}

export function askSaveAndCompleteCurrent(locale: Locale): Promise<boolean> {
  return ask(
    t(locale, "confirm.saveAndCompleteCurrent.message"),
    {
      title: t(locale, "confirm.saveAndCompleteCurrent.title"),
      kind: "warning",
      okLabel: t(locale, "confirm.saveAndCompleteCurrent.save"),
      cancelLabel: t(locale, "confirm.saveAndCompleteCurrent.skip"),
    },
  );
}

/** Pick one or more image files. Returns their absolute paths. */
export async function pickImages(title: string, filterName: string): Promise<string[]> {
  const extensions = await invoke<string[]>("image_extensions");
  const res = await open({
    multiple: true,
    title,
    filters: [{ name: filterName, extensions }],
  });
  if (Array.isArray(res)) return res;
  return typeof res === "string" ? [res] : [];
}

/** Open an external URL in the user's default browser. */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

export const api = {
  pickImageDirectory: (title: string) =>
    invoke<string | null>("pick_image_directory", { title }),
  listImages: (dir: string) =>
    invoke<Omit<ImageItem, "status">[]>("list_images", { dir }),
  imageItems: (paths: string[]) =>
    invoke<Omit<ImageItem, "status">[]>("image_items", { paths }),
  inspectDroppedPaths: (paths: string[]) =>
    invoke<DroppedPaths>("inspect_dropped_paths", { paths }),
  imageSize: (path: string) => invoke<[number, number]>("image_size", { path }),
  readAnnotation: (imagePath: string) =>
    invoke<string | null>("read_annotation", { imagePath }),
  saveAnnotation: (imagePath: string, data: string) =>
    invoke<void>("save_annotation", { imagePath, data }),
  backupAnnotation: (imagePath: string) =>
    invoke<string | null>("backup_annotation", { imagePath }),
  availableDevices: () => invoke<DeviceOption[]>("available_devices"),
  modelOptions: () => invoke<ModelOptions>("model_options"),
  readCustomOcrPaths: () => invoke<CustomOcrPaths>("read_custom_ocr_paths"),
  saveCustomOcrPaths: (paths: CustomOcrPaths) =>
    invoke<void>("save_custom_ocr_paths", { paths }),
  preannotate: (
    imagePath: string,
    mode: Mode,
    ocrModel: string,
    layoutModel: string,
    formulaModel: string,
    device: string,
    thresholds?: InferenceTuning | null,
  ) =>
    invoke<PreannResult>("preannotate", {
      imagePath,
      params: {
        mode,
        ocrModel,
        layoutModel,
        formulaModel,
        device,
        thresholds: thresholds ?? null,
      },
    }),
  cancelPreannotation: () => invoke<void>("cancel_preannotation"),
  recognizeTextRegions: (
    imagePath: string,
    ocrModel: string,
    device: string,
    regions: TextRegionInput[],
    thresholds?: InferenceTuning | null,
  ) =>
    invoke<TextRecognitionRegionResult>("recognize_text_regions", {
      imagePath,
      params: {
        ocrModel,
        device,
        regions,
        thresholds: thresholds ?? null,
      },
    }),
  recognizeFormulaRegions: (
    imagePath: string,
    formulaModel: string,
    device: string,
    regions: TextRegionInput[],
  ) =>
    invoke<TextRecognitionRegionResult>("recognize_formula_regions", {
      imagePath,
      params: {
        formulaModel,
        device,
        regions,
      },
    }),
  pickExportDirectory: (title: string) =>
    invoke<string | null>("pick_export_directory", { title }),
  exportDataset: (
    images: {
      path: string;
      boxes: { points: number[][]; transcription: string; label?: string }[];
    }[],
    outDir: string,
    kind: ExportKind,
  ) => invoke<ExportDatasetResult>("export_dataset", { images, outDir, kind }),
};

// Frameless window controls.
export const appWindow = getCurrentWindow();
export const win = {
  minimize: () => appWindow.minimize(),
  toggleMaximize: () => appWindow.toggleMaximize(),
  close: () => appWindow.close(),
  onCloseRequested: appWindow.onCloseRequested.bind(appWindow),
  onDragDropEvent: appWindow.onDragDropEvent.bind(appWindow),
  toggleFullscreen: async () => {
    const full = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!full);
  },
};
