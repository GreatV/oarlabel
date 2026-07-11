import { create } from "zustand";
import { createAnnotationSlice } from "@/store/annotationSlice";
import { createBatchSlice } from "@/store/batchSlice";
import { createExportSlice } from "@/store/exportSlice";
import { createStoreRuntime } from "@/store/runtime";
import { createSettingsSlice } from "@/store/settingsSlice";
import { createWorkspaceSlice } from "@/store/workspaceSlice";
import type { AppState } from "@/store/types";

export { parseAnnotationFile } from "@/lib/annotationFile";
export {
  normalizeInferenceTuning,
  normalizeRecentDirs,
  normalizeStoredLocale,
  normalizeViewOptions,
} from "@/store/settingsSlice";
export type { AppState } from "@/store/types";

/**
 * Root store composition. Each domain is an independent Zustand StateCreator;
 * StoreRuntime contains the deliberately small set of cross-slice operations
 * (loading, save policy, mutation/history and inference application).
 */
export const useStore = create<AppState>((set, get, api) => {
  const runtime = createStoreRuntime(set, get);
  return {
    ...createWorkspaceSlice(runtime)(set, get, api),
    ...createAnnotationSlice(runtime)(set, get, api),
    ...createSettingsSlice(set, get, api),
    ...createBatchSlice(runtime)(set, get, api),
    ...createExportSlice(runtime)(set, get, api),
  };
});
