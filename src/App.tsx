import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CanvasStage } from "@/components/CanvasStage";
import { FileList } from "@/components/FileList";
import { MenuBar } from "@/components/MenuBar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { StatusBar } from "@/components/StatusBar";
import { TitleBar } from "@/components/TitleBar";
import { Toolbar, type ToolbarDock } from "@/components/Toolbar";
import { AboutDialog } from "@/components/dialogs/AboutDialog";
import { ExportDialog } from "@/components/dialogs/ExportDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { ShortcutsDialog } from "@/components/dialogs/ShortcutsDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { useShortcuts } from "@/hooks/useShortcuts";
import { confirmDiscardChanges, pickDirectory, win } from "@/lib/tauri";
import { useStore } from "@/store";

const TOOLBAR_DOCK_KEY = "oarlabel.toolbarDock";

function loadToolbarDock(): ToolbarDock {
  const value = localStorage.getItem(TOOLBAR_DOCK_KEY);
  return value === "top" || value === "bottom" || value === "left" || value === "right"
    ? value
    : "top";
}

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [fileListWidth, setFileListWidth] = useState(256);
  const [resultsWidth, setResultsWidth] = useState(336);
  const [toolbarDock, setToolbarDock] = useState<ToolbarDock>(loadToolbarDock);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const openFolder = useStore((s) => s.openFolder);
  const refreshModels = useStore((s) => s.refreshModels);
  const view = useStore((s) => s.view);
  const locale = useStore((s) => s.locale);
  useShortcuts();

  const handleOpen = async () => {
    try {
      const dir = await pickDirectory(t(locale, "picker.imageFolder"));
      if (dir) void openFolder(dir);
    } catch (e) {
      useStore.setState({ statusMsg: `${t(locale, "message.openFolderFailed")}: ${String(e)}` });
      console.error("open folder failed", e);
    }
  };

  const handleClose = async () => {
    await win.close();
  };

  const changeToolbarDock = (dock: ToolbarDock) => {
    localStorage.setItem(TOOLBAR_DOCK_KEY, dock);
    setToolbarDock(dock);
  };

  const startResize = (
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? fileListWidth : resultsWidth;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next =
        side === "left" ? startWidth + delta : startWidth - delta;
      const clamped = Math.min(480, Math.max(192, next));
      if (side === "left") setFileListWidth(clamped);
      else setResultsWidth(clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    win.onCloseRequested(async (event) => {
      if (useStore.getState().dirty && !(await confirmDiscardChanges())) {
        event.preventDefault();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TooltipProvider delayDuration={400}>
        <TitleBar onClose={handleClose} />
        <MenuBar
          onOpen={handleOpen}
          onExport={() => setExportOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
          onAbout={() => setAboutOpen(true)}
          onClose={handleClose}
        />
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
          {view.fileList && (
            <FileList
              collapsed={collapsed}
              onToggle={() => setCollapsed((c) => !c)}
              width={fileListWidth}
            />
          )}
          {view.fileList && !collapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t(locale, "layout.resizeFileList")}
              className="w-1 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
              onPointerDown={(e) => startResize("left", e)}
            />
          )}
          <div className="min-w-0 flex-1">
            <CanvasStage />
          </div>
          {view.results && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t(locale, "layout.resizeResults")}
              className="w-1 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
              onPointerDown={(e) => startResize("right", e)}
            />
          )}
          {view.results && <ResultsPanel width={resultsWidth} />}
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

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      </TooltipProvider>
    </div>
  );
}

export default App;
