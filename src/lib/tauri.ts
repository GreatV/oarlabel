// Typed wrappers around the Tauri command/event/asset APIs.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  ImageItem,
  ModelOptions,
  ModelStatus,
  PreannBox,
  Mode,
} from "@/types";

export function fileSrc(path: string): string {
  return convertFileSrc(path);
}

export async function pickDirectory(title: string): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

export function confirmDiscardChanges(): Promise<boolean> {
  return confirm(
    "There are unsaved annotation changes. Continue and discard them?",
    { title: "Unsaved changes", kind: "warning" },
  );
}

export function confirmReplaceAnnotations(count: number): Promise<boolean> {
  return confirm(
    `This will replace ${count} existing annotation${count === 1 ? "" : "s"} on the current image. Continue?`,
    { title: "Replace annotations", kind: "warning" },
  );
}

export function confirmReplaceBatchAnnotations(
  imageCount: number,
  annotatedImageCount: number,
  annotationCount: number,
): Promise<boolean> {
  return confirm(
    `Batch pre-annotation will process ${imageCount} images and replace ${annotationCount} existing annotation${annotationCount === 1 ? "" : "s"} on ${annotatedImageCount} image${annotatedImageCount === 1 ? "" : "s"}. Continue?`,
    { title: "Replace annotations", kind: "warning" },
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
  readModelConfig: () => invoke<string>("read_model_config"),
  saveModelConfig: (text: string) => invoke<void>("save_model_config", { text }),
  preannotate: (
    imagePath: string,
    mode: Mode,
    ocrModel: string,
    layoutModel: string,
    formulaModel: string,
    tableModel: string,
    device: string,
  ) =>
    invoke<PreannBox[]>("preannotate", {
      imagePath,
      mode,
      ocrModel,
      layoutModel,
      formulaModel,
      tableModel,
      device,
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
