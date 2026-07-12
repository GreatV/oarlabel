// Bridges the macOS native global menu to the React store / dialogs.
//
// On macOS the in-window `MenuBar.tsx` is unmounted and a real native menu
// takes over (built in `src-tauri/src/menu.rs`). Native items can't call into
// the store directly, so the Rust side emits a `oar:*` event per item and this
// hook dispatches it to the matching store action or dialog opener. On other
// platforms it is a no-op (no events are emitted there).

import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { shallow } from "zustand/shallow";
import { t, type MessageKey } from "@/i18n";
import { isMac } from "@/lib/platform";
import {
  changedMenuStatePayloads,
  nativeMenuEnabledState,
  NATIVE_RECENT_LIMIT,
} from "@/lib/nativeMenu";
import { api, pickImages } from "@/lib/tauri";
import { useStore, type AppState } from "@/store";
import {
  VIEW_KEYS,
  type ModelOption,
  type ViewOptions,
} from "@/types";

/** Dialogs the native menu can open. Provided by App.tsx. */
export interface NativeMenuOpeners {
  openFolder: () => Promise<void>;
  openExport: () => void;
  openSettings: () => void;
  openShortcuts: () => void;
  openAbout: () => void;
}

interface NativeMenuPayload {
  locale: string;
  view: ViewOptions;
  ocrModel: string;
  layoutModel: string;
  formulaModel: string;
  autoSave: boolean;
  recentDirs: string[];
}

function nativeMenuSyncState(state: AppState) {
  const image = state.images[state.currentIndex];
  const path = image?.path;
  const nextPath = state.images[state.currentIndex + 1]?.path;
  return {
    locale: state.locale,
    view: state.view,
    ocrModel: state.ocrModel,
    layoutModel: state.layoutModel,
    formulaModel: state.formulaModel,
    autoSave: state.autoSave,
    recentDirs: state.recentDirs,
    hasImage: !!image,
    hasImages: state.images.length > 0,
    hasSelection: state.selectedIds.length > 0,
    busy: state.busy,
    batchRunning: state.batchRunning,
    currentLocked: state.busy || (!!path && state.batchPendingPaths[path] === true),
    nextLocked: !nextPath || state.batchPendingPaths[nextPath] === true,
    hasUndo: !!path && (state.past[path]?.length ?? 0) > 0,
    hasRedo: !!path && (state.future[path]?.length ?? 0) > 0,
    hasClipboard: state.clipboard.length > 0,
    recentCount: state.recentDirs.length,
  };
}

export function useNativeMenu(openers: NativeMenuOpeners): void {
  useEffect(() => {
    if (!isMac) return;

    // Keep the native menu in sync with React state. Two channels:
    //  - rebuild (locale change, model-catalog change): Rust rebuilds the whole
    //    menu; we send {locale, view} so View checkbox items are created with
    //    their real checked value (no post-rebuild fixup needed).
    //  - live toggle (toggleView / resetLayout): per-key
    //    `oar:set-menu-state` updates existing checked items without a full rebuild.
    let lastLocale = useStore.getState().locale;
    let lastView = { ...useStore.getState().view };
    let lastOcrModel = useStore.getState().ocrModel;
    let lastLayoutModel = useStore.getState().layoutModel;
    let lastFormulaModel = useStore.getState().formulaModel;
    let lastAutoSave = useStore.getState().autoSave;
    let lastRecentDirs = [...useStore.getState().recentDirs];
    let lastEnabled: Record<string, boolean> = {};

    const enabledState = (
      state = nativeMenuSyncState(useStore.getState()),
    ): Record<string, boolean> => {
      return nativeMenuEnabledState({
        hasImage: state.hasImage,
        hasImages: state.hasImages,
        hasSelection: state.hasSelection,
        busy: state.busy,
        batchRunning: state.batchRunning,
        currentLocked: state.currentLocked,
        nextLocked: state.nextLocked,
        hasUndo: state.hasUndo,
        hasRedo: state.hasRedo,
        hasClipboard: state.hasClipboard,
        recentCount: state.recentCount,
      });
    };

    const syncEnabled = (
      force = false,
      state = nativeMenuSyncState(useStore.getState()),
    ) => {
      const next = enabledState(state);
      for (const payload of changedMenuStatePayloads(lastEnabled, next, force)) {
        void emit("oar:set-menu-enabled", payload);
      }
      lastEnabled = next;
    };

    // Build the structured rebuild payload Rust parses into (locale, ViewState).
    // Send it as an object, not a JSON string, so Rust receives the exact shape
    // it deserializes.
    const rebuildPayload = (): NativeMenuPayload => {
      const {
        locale,
        view,
        ocrModel,
        layoutModel,
        formulaModel,
        autoSave,
        recentDirs,
      } = useStore.getState();
      return {
        locale,
        view,
        ocrModel,
        layoutModel,
        formulaModel,
        autoSave,
        recentDirs,
      };
    };
    const rebuildNow = (event: string) => {
      const state = useStore.getState();
      lastLocale = state.locale;
      lastView = { ...state.view };
      lastOcrModel = state.ocrModel;
      lastLayoutModel = state.layoutModel;
      lastFormulaModel = state.formulaModel;
      lastAutoSave = state.autoSave;
      lastRecentDirs = [...state.recentDirs];
      lastEnabled = {};
      void emit(event, rebuildPayload()).then(() => syncEnabled(true));
    };

    // Initial build in the real locale, with the real view state seeded in.
    rebuildNow("oar:set-locale");

    const sync = (state: ReturnType<typeof nativeMenuSyncState>) => {
      const {
        locale,
        view,
        ocrModel,
        layoutModel,
        formulaModel,
        autoSave,
        recentDirs,
      } = state;
      const modelOptions = useStore.getState().modelOptions;
      // Live per-key sync for toggleView / resetLayout. Emit each changed key
      // (a full reset flips all 7) so the native items track React state
      // without a full menu rebuild.
      const changed = VIEW_KEYS.some((k) => view[k] !== lastView[k]);
      if (changed) {
        lastView = { ...view };
        for (const key of VIEW_KEYS) {
          void emit("oar:set-menu-state", { id: `oar:view:${key}`, value: view[key] });
        }
      }
      if (autoSave !== lastAutoSave) {
        lastAutoSave = autoSave;
        void emit("oar:set-menu-state", { id: "oar:auto-save", value: autoSave });
      }
      const syncModelGroup = (
        kind: "ocr" | "layout" | "formula",
        options: ModelOption[] | undefined,
        selected: string,
      ) => {
        for (const option of options ?? []) {
          void emit(
            "oar:set-menu-state",
            {
              id: `oar:model:${kind}:${option.key}`,
              value: option.key === selected,
            },
          );
        }
      };
      if (ocrModel !== lastOcrModel) {
        lastOcrModel = ocrModel;
        syncModelGroup("ocr", modelOptions?.ocr_profiles, ocrModel);
      }
      if (layoutModel !== lastLayoutModel) {
        lastLayoutModel = layoutModel;
        syncModelGroup("layout", modelOptions?.layout_models, layoutModel);
      }
      if (formulaModel !== lastFormulaModel) {
        lastFormulaModel = formulaModel;
        syncModelGroup("formula", modelOptions?.formula_profiles, formulaModel);
      }
      if (locale !== lastLocale) {
        // Locale change: full rebuild, seeding view/theme state into the new menu.
        rebuildNow("oar:set-locale");
      } else if (
        recentDirs.length !== lastRecentDirs.length ||
        recentDirs.some((dir, index) => dir !== lastRecentDirs[index])
      ) {
        rebuildNow("oar:rebuild-menu");
      }
      syncEnabled(false, state);
    };
    const unsubStore = useStore.subscribe(nativeMenuSyncState, sync, {
      equalityFn: shallow,
    });

    // File-menu items need a picker dialog before hitting the store. Wrapped
    // in try/catch so a picker/IPC failure surfaces a status message instead
    // of being swallowed (the in-window MenuBar path gets this from the store
    // action's own try/catch, but here we own the picker call).
    const fail = (e: unknown, key: MessageKey) => {
      const l = useStore.getState().locale;
      useStore.setState({ statusMsg: `${t(l, key)}: ${String(e)}` });
    };
    const pickFolder = async () => {
      try {
        const dir = await api.pickImageDirectory(
          t(useStore.getState().locale, "picker.imageFolder"),
        );
        if (dir) void useStore.getState().openFolder(dir);
      } catch (e) {
        fail(e, "message.loadFailed");
      }
    };
    const importImages = async () => {
      try {
        const l = useStore.getState().locale;
        const paths = await pickImages(t(l, "picker.images"), t(l, "picker.imageFilter"));
        if (paths.length) useStore.getState().openFiles(paths);
      } catch (e) {
        fail(e, "message.loadFailed");
      }
    };
    const routes: Record<string, () => void> = {
      "oar:open-folder": () => void pickFolder(),
      "oar:import-images": () => void importImages(),
      "oar:save": () => void useStore.getState().save(),
      "oar:save-and-next": () => void useStore.getState().saveAndNext(),
      "oar:export": openers.openExport,
      "oar:undo": () => useStore.getState().undo(),
      "oar:redo": () => useStore.getState().redo(),
      "oar:copy": () => useStore.getState().copySelection(),
      "oar:paste": () => useStore.getState().paste(),
      "oar:select-all": () => useStore.getState().selectAll(),
      "oar:clear-sel": () => useStore.getState().clearSelection(),
      "oar:delete": () => useStore.getState().removeSelected(),
      "oar:zoom-in": () => useStore.getState().setZoom(useStore.getState().zoom * 1.2),
      "oar:zoom-out": () => useStore.getState().setZoom(useStore.getState().zoom / 1.2),
      "oar:actual": () => useStore.getState().requestFit("actual"),
      "oar:fit-window": () => useStore.getState().requestFit("window"),
      "oar:fit-width": () => useStore.getState().requestFit("width"),
      "oar:reset-layout": () => useStore.getState().resetLayout(),
      "oar:settings": openers.openSettings,
      "oar:shortcuts": openers.openShortcuts,
      "oar:about": openers.openAbout,
    };

    // Apply a model selection. `spec` is "<kind>:<key>" (Rust emits the part
    // after "oar:model:" as the oar:model-select payload). Kept as a helper so
    // it works for both the legacy per-id path and the umbrella listener.
    const applyModel = (spec: string) => {
      // spec = "<kind>:<key>" — key may contain colons, so split with limit.
      const parts = spec.split(":");
      const kind = parts[0];
      const key = parts.slice(1).join(":");
      const s = useStore.getState();
      if (kind === "ocr") s.setOcrModel(key);
      else if (kind === "layout") s.setLayoutModel(key);
      else if (kind === "formula") s.setFormulaModel(key);
    };

    // Dispatch a single menu id, handling the dynamic prefixes.
    const dispatch = (id: string) => {
      if (routes[id]) return routes[id]();
      if (id.startsWith("oar:view:")) {
        const key = id.slice("oar:view:".length) as (typeof VIEW_KEYS)[number];
        useStore.getState().toggleView(key);
        return;
      }
      if (id === "oar:auto-save") {
        const s = useStore.getState();
        s.setAutoSave(!s.autoSave);
        return;
      }
      if (id.startsWith("oar:recent:")) {
        const index = Number(id.slice("oar:recent:".length));
        const dir = useStore.getState().recentDirs[index];
        if (dir) void useStore.getState().openFolder(dir);
        return;
      }
      if (id.startsWith("oar:model:")) {
        applyModel(id.slice("oar:model:".length));
      }
    };

    // Static ids known up front. Model selection is handled by a SINGLE
    // umbrella listener (oar:model-select) registered below, not per-id, so a
    // click works even before modelOptions has loaded and survives rebuilds.
    const ids = new Set<string>(Object.keys(routes));
    for (const k of VIEW_KEYS) ids.add(`oar:view:${k}`);
    ids.add("oar:auto-save");
    for (let index = 0; index < NATIVE_RECENT_LIMIT; index += 1) {
      ids.add(`oar:recent:${index}`);
    }

    const unsubs: Array<() => void> = [];
    const install = (id: string) => {
      const stop = listen<void>(id, () => dispatch(id));
      unsubs.push(() => void stop.then((f) => f()));
    };
    for (const id of ids) install(id);

    // One stable listener for all model selections. Rust emits
    // `oar:model-select` with the "<kind>:<key>" payload for any oar:model:*
    // menu id, so this works regardless of catalog load state or rebuilds.
    {
      const stop = listen<string>("oar:model-select", (e) => {
        if (e.payload) applyModel(e.payload);
      });
      unsubs.push(() => void stop.then((f) => f()));
    }

    // When the model catalog changes (e.g. saving a custom config in Settings),
    // rebuild the native menu so the new options appear. The rebuild payload
    // carries the current view state so checkbox items stay correct.
    const unsubOpts = useStore.subscribe(
      (state) => state.modelOptions,
      (next, previous) => {
        if (next !== previous) {
        rebuildNow("oar:rebuild-menu");
        }
      },
    );

    return () => {
      unsubStore();
      unsubOpts();
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
