import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CanvasStage } from "@/components/CanvasStage";
import { FileList } from "@/components/FileList";
import { MenuBar } from "@/components/MenuBar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { StatusBar } from "@/components/StatusBar";
import { TitleBar } from "@/components/TitleBar";
import { Toolbar, type ToolbarDock } from "@/components/Toolbar";
import { AboutDialog } from "@/components/dialogs/AboutDialog";
import { ExportDialog } from "@/components/dialogs/ExportDialog";
import {
  SettingsDialog,
  type SettingsSection,
} from "@/components/dialogs/SettingsDialog";
import { ShortcutsDialog } from "@/components/dialogs/ShortcutsDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useNativeMenu } from "@/hooks/useNativeMenu";
import { useTheme } from "@/hooks/useTheme";
import { api, confirmDiscardChanges, win } from "@/lib/tauri";
import { isMac } from "@/lib/platform";
import {
  DEFAULT_PANEL_DOCKS,
  movePanelInOrder,
  normalizePanelDocks,
  normalizePanelOrder,
  normalizePanelSplitRatios,
  PANEL_DOCK_STORAGE_KEY,
  PANEL_ORDER_STORAGE_KEY,
  PANEL_SPLIT_STORAGE_KEY,
  panelsForSide,
  type PanelDocks,
  type PanelId,
  type PanelSide,
  type PanelSplitRatios,
  type PanelStackPosition,
} from "@/lib/panelDock";
import { useStore } from "@/store";

const TOOLBAR_DOCK_KEY = "oarlabel.toolbarDock";
const FILE_LIST_WIDTH_KEY = "oarlabel.fileListWidth";
const RESULTS_WIDTH_KEY = "oarlabel.resultsWidth";

function loadPanelWidth(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(480, Math.max(192, value)) : fallback;
}

function loadToolbarDock(): ToolbarDock {
  const value = localStorage.getItem(TOOLBAR_DOCK_KEY);
  return value === "top" || value === "bottom" || value === "left" || value === "right"
    ? value
    : "top";
}

function loadPanelDocks(): PanelDocks {
  try {
    const raw = localStorage.getItem(PANEL_DOCK_STORAGE_KEY);
    return normalizePanelDocks(raw === null ? null : JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PANEL_DOCKS };
  }
}

function loadPanelOrder(): PanelId[] {
  try {
    const raw = localStorage.getItem(PANEL_ORDER_STORAGE_KEY);
    return normalizePanelOrder(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizePanelOrder(null);
  }
}

function loadPanelSplitRatios(): PanelSplitRatios {
  try {
    const raw = localStorage.getItem(PANEL_SPLIT_STORAGE_KEY);
    return normalizePanelSplitRatios(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizePanelSplitRatios(null);
  }
}

interface PanelDropTarget {
  side: PanelSide;
  position: PanelStackPosition;
}

function panelDropTargetAt(clientX: number, clientY: number): PanelDropTarget {
  return {
    side: clientX < window.innerWidth / 2 ? "left" : "right",
    position: clientY < window.innerHeight / 2 ? "top" : "bottom",
  };
}

function App() {
  const [collapsedSides, setCollapsedSides] = useState<Record<PanelSide, boolean>>({
    left: false,
    right: false,
  });
  const [fileListWidth, setFileListWidth] = useState(() =>
    loadPanelWidth(FILE_LIST_WIDTH_KEY, 256),
  );
  const [resultsWidth, setResultsWidth] = useState(() =>
    loadPanelWidth(RESULTS_WIDTH_KEY, 336),
  );
  const [toolbarDock, setToolbarDock] = useState<ToolbarDock>(loadToolbarDock);
  const [panelDocks, setPanelDocks] = useState<PanelDocks>(loadPanelDocks);
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(loadPanelOrder);
  const [panelSplitRatios, setPanelSplitRatios] =
    useState<PanelSplitRatios>(loadPanelSplitRatios);
  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [panelDropTarget, setPanelDropTarget] = useState<PanelDropTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeConfirmationRef = useRef<Promise<boolean> | null>(null);

  const openFolder = useStore((s) => s.openFolder);
  const refreshModels = useStore((s) => s.refreshModels);
  const view = useStore((s) => s.view);
  const locale = useStore((s) => s.locale);
  useTheme();

  const handleOpen = async () => {
    try {
      const dir = await api.pickImageDirectory(t(locale, "picker.imageFolder"));
      if (dir) void openFolder(dir);
    } catch (e) {
      useStore.setState({ statusMsg: `${t(locale, "message.openFolderFailed")}: ${String(e)}` });
      console.error("open folder failed", e);
    }
  };

  const handleClose = async () => {
    await win.close();
  };

  const openSettings = useCallback((section: SettingsSection = "general") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  useShortcuts(openSettings);

  // On macOS the native global menu (built in Rust) replaces the in-window
  // MenuBar; this hook routes its events to the store and these dialogs.
  useNativeMenu({
    openFolder: handleOpen,
    openExport: () => setExportOpen(true),
    openSettings,
    openShortcuts: () => setShortcutsOpen(true),
    openAbout: () => setAboutOpen(true),
  });

  const changeToolbarDock = (dock: ToolbarDock) => {
    localStorage.setItem(TOOLBAR_DOCK_KEY, dock);
    setToolbarDock(dock);
  };

  const startResize = (
    panels: PanelId[],
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = Math.max(
      ...panels.map((panel) => (panel === "fileList" ? fileListWidth : resultsWidth)),
    );
    const minWidth = panels.includes("results") ? 256 : 192;
    let latestWidth = startWidth;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta =
        side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const next = startWidth + delta;
      const clamped = Math.min(480, Math.max(minWidth, next));
      latestWidth = clamped;
      if (panels.includes("fileList")) setFileListWidth(clamped);
      if (panels.includes("results")) setResultsWidth(clamped);
    };
    const onUp = () => {
      if (panels.includes("fileList")) {
        localStorage.setItem(FILE_LIST_WIDTH_KEY, String(latestWidth));
      }
      if (panels.includes("results")) {
        localStorage.setItem(RESULTS_WIDTH_KEY, String(latestWidth));
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startPanelDockDrag = (
    panel: PanelId,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    setDraggingPanel(panel);
    setPanelDropTarget(panelDropTargetAt(event.clientX, event.clientY));
  };

  const startPanelStackResize = (
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const startY = event.clientY;
    const startRatio = panelSplitRatios[side];
    const height = container.getBoundingClientRect().height;
    let latestRatio = startRatio;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const next = startRatio + (moveEvent.clientY - startY) / height;
      latestRatio = Math.min(0.85, Math.max(0.15, next));
      setPanelSplitRatios((current) => ({ ...current, [side]: latestRatio }));
    };
    const onUp = () => {
      const next = { ...panelSplitRatios, [side]: latestRatio };
      localStorage.setItem(PANEL_SPLIT_STORAGE_KEY, JSON.stringify(next));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (!draggingPanel) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      setPanelDropTarget(panelDropTargetAt(event.clientX, event.clientY));
    };
    const onUp = (event: PointerEvent) => {
      event.preventDefault();
      const target = panelDropTargetAt(event.clientX, event.clientY);
      setPanelDocks((current) => {
        const next = { ...current, [draggingPanel]: target.side };
        localStorage.setItem(PANEL_DOCK_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setPanelOrder((current) => {
        const next = movePanelInOrder(current, draggingPanel, target.position);
        localStorage.setItem(PANEL_ORDER_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setDraggingPanel(null);
      setPanelDropTarget(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draggingPanel]);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const unlistenPromise = win.onCloseRequested(async (event) => {
      const state = useStore.getState();
      if (!state.dirty) return;

      // Reuse an in-flight confirmation if multiple close requests arrive
      // together (for example from a rapid double-click or a native shortcut).
      const confirmation =
        closeConfirmationRef.current ?? confirmDiscardChanges(state.locale);
      closeConfirmationRef.current = confirmation;
      try {
        if (!(await confirmation)) event.preventDefault();
      } finally {
        if (closeConfirmationRef.current === confirmation) {
          closeConfirmationRef.current = null;
        }
      }
    });

    // Registration is asynchronous. React StrictMode mounts, cleans up, and
    // mounts effects again in development; waiting for the registration before
    // unsubscribing prevents the first listener from leaking into the second.
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const resizeHandle = (panels: PanelId[], side: PanelSide) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t(locale, panels.length > 1 ? "layout.resizePanels" : panels[0] === "fileList" ? "layout.resizeFileList" : "layout.resizeResults")}
      className="w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
      onPointerDown={(event) => startResize(panels, side, event)}
    />
  );

  const togglePanelCollapsed = (panel: PanelId) => {
    const side = panelDocks[panel];
    setCollapsedSides((current) => ({ ...current, [side]: !current[side] }));
  };

  const renderPanel = (panel: PanelId, side: PanelSide, collapsed: boolean) => {
    if (panel === "fileList") {
      return (
        <FileList
          collapsed={collapsed}
          onToggle={() => togglePanelCollapsed("fileList")}
          side={side}
          onDockDragStart={(event) => startPanelDockDrag(panel, event)}
        />
      );
    }
    return (
      <ResultsPanel
        collapsed={collapsed}
        onToggle={() => togglePanelCollapsed("results")}
        side={side}
        onDockDragStart={(event) => startPanelDockDrag(panel, event)}
      />
    );
  };

  const renderSidePanels = (side: PanelSide) => {
    const panels = panelsForSide(panelDocks, view, side, panelOrder);
    if (!panels.length) return null;
    const sideCollapsed = collapsedSides[side];
    const width = sideCollapsed
      ? 40
      : Math.max(
          panels.includes("results") ? 256 : 192,
          ...panels.map((panel) => (panel === "fileList" ? fileListWidth : resultsWidth)),
        );
    const resizableStack = panels.length === 2 && !sideCollapsed;
    const column = (
      <div
        className={`flex h-full shrink-0 flex-col overflow-hidden ${
          side === "left" ? "border-r" : "border-l"
        }`}
        style={{ width }}
      >
        {panels.map((panel, index) => (
          <Fragment key={panel}>
            {index > 0 &&
              (resizableStack ? (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t(locale, "layout.resizePanelStack")}
                  className="h-1 shrink-0 cursor-row-resize bg-border/60 transition-colors hover:bg-primary/50"
                  onPointerDown={(event) => startPanelStackResize(side, event)}
                />
              ) : (
                <div className="h-px shrink-0 bg-border" />
              ))}
            <div
              className={
                resizableStack
                  ? "min-h-0 shrink-0"
                  : sideCollapsed
                    ? "shrink-0"
                    : "min-h-0 flex-1"
              }
              style={
                resizableStack
                  ? {
                      height: `calc(${(
                        (index === 0
                          ? panelSplitRatios[side]
                          : 1 - panelSplitRatios[side]) * 100
                      ).toFixed(3)}% - 2px)`,
                    }
                  : undefined
              }
            >
              {renderPanel(panel, side, sideCollapsed)}
            </div>
          </Fragment>
        ))}
      </div>
    );
    return (
      <Fragment>
        {side === "right" && !sideCollapsed && resizeHandle(panels, side)}
        {column}
        {side === "left" && !sideCollapsed && resizeHandle(panels, side)}
      </Fragment>
    );
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TooltipProvider delayDuration={400}>
        <TitleBar onClose={handleClose} />
        {/* On macOS the native global menu replaces this in-window menubar. */}
        {!isMac && (
          <MenuBar
            onOpen={handleOpen}
            onExport={() => setExportOpen(true)}
            onSettings={openSettings}
            onShortcuts={() => setShortcutsOpen(true)}
            onAbout={() => setAboutOpen(true)}
            onClose={handleClose}
          />
        )}
        {view.toolbar && toolbarDock === "top" && (
          <Toolbar
            dock={toolbarDock}
            onDockChange={changeToolbarDock}
            onOpen={handleOpen}
            onExport={() => setExportOpen(true)}
          />
        )}

        <main className="flex min-h-0 flex-1" role="main" aria-label="oarlabel workspace">
          {view.toolbar && toolbarDock === "left" && (
            <Toolbar
              dock={toolbarDock}
              onDockChange={changeToolbarDock}
              onOpen={handleOpen}
              onExport={() => setExportOpen(true)}
            />
          )}
          {renderSidePanels("left")}
          <div className="min-w-0 flex-1">
            <CanvasStage />
          </div>
          {renderSidePanels("right")}
          {view.toolbar && toolbarDock === "right" && (
            <Toolbar
              dock={toolbarDock}
              onDockChange={changeToolbarDock}
              onOpen={handleOpen}
              onExport={() => setExportOpen(true)}
            />
          )}
        </main>

        {view.toolbar && toolbarDock === "bottom" && (
          <Toolbar
            dock={toolbarDock}
            onDockChange={changeToolbarDock}
            onOpen={handleOpen}
            onExport={() => setExportOpen(true)}
          />
        )}

        {view.statusBar && <StatusBar />}

        {draggingPanel && panelDropTarget && (
          <div className="pointer-events-none fixed inset-0 z-50 grid grid-cols-2 grid-rows-2" aria-hidden="true">
            {(
              [
                { side: "left", position: "top", label: "layout.dockLeftTop" },
                { side: "right", position: "top", label: "layout.dockRightTop" },
                { side: "left", position: "bottom", label: "layout.dockLeftBottom" },
                { side: "right", position: "bottom", label: "layout.dockRightBottom" },
              ] as const
            ).map((target) => (
              <div
                key={`${target.side}-${target.position}`}
                className={`flex items-center justify-center border-2 transition-colors ${
                  panelDropTarget.side === target.side && panelDropTarget.position === target.position
                    ? "border-primary bg-primary/15"
                    : "border-transparent bg-background/20"
                }`}
              >
                <span
                  className={`rounded bg-card/95 px-4 py-2 text-sm font-medium shadow ${
                    panelDropTarget.side === target.side && panelDropTarget.position === target.position
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {t(locale, target.label)}
                </span>
              </div>
            ))}
          </div>
        )}

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSection={settingsSection}
        />
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      </TooltipProvider>
    </div>
  );
}

export default App;
