// Typed wrappers around the Tauri command/event/asset APIs.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, tt, type Locale } from "@/i18n";
import type {
  CustomOcrPaths,
  ImageItem,
  InferenceTuning,
  ModelOptions,
  ModelStatus,
  PreannResult,
  TextRecognitionRegionResult,
  TextRegionInput,
  Mode,
} from "@/types";

export function fileSrc(path: string): string {
  return convertFileSrc(path);
}

export async function pickDirectory(title: string): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
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
  imageCount: number,
  annotatedImageCount: number,
  annotationCount: number,
): Promise<boolean> {
  return confirm(
    tt(locale, "confirm.replaceBatchAnnotations.message", {
      imageCount,
      annotatedImageCount,
      annotationCount,
    }),
    { title: t(locale, "confirm.replaceAnnotations.title"), kind: "warning" },
  );
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "bmp", "webp", "gif", "tif", "tiff"];

/** Pick one or more image files. Returns their absolute paths. */
export async function pickImages(title: string, filterName: string): Promise<string[]> {
  const res = await open({
    multiple: true,
    title,
    filters: [{ name: filterName, extensions: IMAGE_EXTENSIONS }],
  });
  if (Array.isArray(res)) return res;
  return typeof res === "string" ? [res] : [];
}

/** Pick a single PDF file. Returns its absolute path. */
export async function pickPdf(title: string): Promise<string | null> {
  const res = await open({
    multiple: false,
    title,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return typeof res === "string" ? res : null;
}

/** Open an external URL in the user's default browser. */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

export const api = {
  listImages: (dir: string) =>
    invoke<Omit<ImageItem, "status">[]>("list_images", { dir }),
  imageItems: (paths: string[]) =>
    invoke<Omit<ImageItem, "status">[]>("image_items", { paths }),
  importPdf: (pdfPath: string, outDir?: string) =>
    invoke<Omit<ImageItem, "status">[]>("import_pdf", { pdfPath, outDir: outDir ?? null }),
  imageSize: (path: string) => invoke<[number, number]>("image_size", { path }),
  readAnnotation: (imagePath: string) =>
    invoke<string | null>("read_annotation", { imagePath }),
  saveAnnotation: (imagePath: string, data: string) =>
    invoke<void>("save_annotation", { imagePath, data }),
  modelStatus: () => invoke<ModelStatus[]>("model_status"),
  modelOptions: () => invoke<ModelOptions>("model_options"),
  readCustomOcrPaths: () => invoke<CustomOcrPaths>("read_custom_ocr_paths"),
  saveCustomOcrPaths: (paths: CustomOcrPaths) =>
    invoke<void>("save_custom_ocr_paths", { paths }),
  preannotate: (
    imagePath: string,
    mode: Mode | "structure",
    ocrModel: string,
    layoutModel: string,
    formulaModel: string,
    tableModel: string,
    device: string,
    modes?: Mode[],
    thresholds?: InferenceTuning | null,
  ) =>
    invoke<PreannResult>("preannotate", {
      imagePath,
      params: {
        mode,
        modes: modes ?? [],
        ocrModel,
        layoutModel,
        formulaModel,
        tableModel,
        device,
        thresholds: thresholds ?? null,
      },
    }),
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
  exportDataset: (
    images: { path: string; boxes: { points: number[][]; transcription: string }[] }[],
    outDir: string,
    kind: "detection" | "recognition",
  ) => invoke<string>("export_dataset", { images, outDir, kind }),
};

// Frameless window controls.
export const appWindow = getCurrentWindow();
export const win = {
  minimize: () => appWindow.minimize(),
  toggleMaximize: () => appWindow.toggleMaximize(),
  close: () => appWindow.close(),
  onCloseRequested: appWindow.onCloseRequested.bind(appWindow),
  toggleFullscreen: async () => {
    const full = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!full);
  },
};
