import {
  BookOpen,
  CheckSquare,
  ClipboardPaste,
  Clock,
  Copy,
  FileImage,
  FolderOpen,
  HelpCircle,
  Info,
  Keyboard,
  LayoutTemplate,
  LogOut,
  Maximize,
  MessageSquare,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  ScanText,
  Sigma,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  XSquare,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { t } from "@/i18n";
import { LINKS } from "@/lib/links";
import { shortcut } from "@/lib/platform";
import { openExternal, pickImages, win } from "@/lib/tauri";
import { useStore } from "@/store";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";

interface MenuBarProps {
  onOpen: () => void;
  onExport: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
  onClose: () => void;
}

const ico = "h-4 w-4 text-muted-foreground";

function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function MenuBar({
  onOpen,
  onExport,
  onSettings,
  onShortcuts,
  onAbout,
  onClose,
}: MenuBarProps) {
  const s = useStore(
    useShallow((state) => {
      const currentImage = state.images[state.currentIndex];
      const nextImage = state.images[state.currentIndex + 1];
      return {
        locale: state.locale,
        hasImage: !!currentImage,
        imageCount: state.images.length,
        currentLocked:
          state.busy || (!!currentImage && state.batchPendingPaths[currentImage.path] === true),
        nextLocked:
          state.currentIndex < 0 ||
          state.currentIndex >= state.images.length - 1 ||
          (!!nextImage && state.batchPendingPaths[nextImage.path] === true),
        batchConflict: state.busy || state.batchRunning,
        hasSelection: state.selectedIds.length > 0,
        clipboardCount: state.clipboard.length,
        recentDirs: state.recentDirs,
        autoSave: state.autoSave,
        view: state.view,
        modelOptions: state.modelOptions,
        ocrModel: state.ocrModel,
        layoutModel: state.layoutModel,
        formulaModel: state.formulaModel,
        openFiles: state.openFiles,
        openFolder: state.openFolder,
        save: state.save,
        saveAndNext: state.saveAndNext,
        setAutoSave: state.setAutoSave,
        undo: state.undo,
        redo: state.redo,
        copySelection: state.copySelection,
        paste: state.paste,
        selectAll: state.selectAll,
        clearSelection: state.clearSelection,
        removeSelected: state.removeSelected,
        requestFit: state.requestFit,
        toggleView: state.toggleView,
        resetLayout: state.resetLayout,
        setOcrModel: state.setOcrModel,
        setLayoutModel: state.setLayoutModel,
        setFormulaModel: state.setFormulaModel,
      };
    }),
  );
  const l = s.locale;
  const { hasImage, currentLocked, batchConflict, nextLocked, hasSelection } = s;
  const modelOptions = s.modelOptions;

  const handleImportImages = async () => {
    const paths = await pickImages(t(l, "picker.images"), t(l, "picker.imageFilter"));
    if (paths.length) s.openFiles(paths);
  };
  return (
    <Menubar className="border-b bg-card px-2 py-1">
      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.file")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarItem onClick={onOpen} disabled={batchConflict}>
            <FolderOpen className={ico} />
            {t(l, "menu.file.importFolder")}
          </MenubarItem>
          <MenubarItem onClick={handleImportImages} disabled={batchConflict}>
            <FileImage className={ico} />
            {t(l, "menu.file.importImages")}
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger>
              <Clock className={ico} />
              {t(l, "menu.file.recent")}
            </MenubarSubTrigger>
            <MenubarSubContent className="max-w-[20rem]">
              {s.recentDirs.length === 0 ? (
                <MenubarItem disabled>{t(l, "menu.file.noRecent")}</MenubarItem>
              ) : (
                s.recentDirs.map((d) => (
                  <MenubarItem key={d} disabled={batchConflict} onClick={() => s.openFolder(d)} title={d}>
                    <span className="truncate">{baseName(d)}</span>
                  </MenubarItem>
                ))
              )}
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSeparator />
          <MenubarItem onClick={() => s.save()} disabled={!hasImage || currentLocked}>
            <Save className={ico} />
            {t(l, "menu.file.save")}
            <MenubarShortcut>{shortcut("Ctrl+S")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => void s.saveAndNext()} disabled={!hasImage || currentLocked || nextLocked}>
            {t(l, "menu.file.saveAndNext")}
            <MenubarShortcut>{shortcut("Ctrl+Enter")}</MenubarShortcut>
          </MenubarItem>
          <MenubarCheckboxItem
            checked={s.autoSave}
            onCheckedChange={(checked) => s.setAutoSave(checked === true)}
          >
            {t(l, "menu.file.autoSave")}
          </MenubarCheckboxItem>
          <MenubarItem onClick={onExport} disabled={!s.imageCount || batchConflict}>
            <Upload className={ico} />
            {t(l, "menu.file.export")}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={onClose}>
            <LogOut className={ico} />
            {t(l, "menu.file.exit")}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.edit")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarItem onClick={() => s.undo()} disabled={currentLocked}>
            <Undo2 className={ico} />
            {t(l, "menu.edit.undo")}
            <MenubarShortcut>{shortcut("Ctrl+Z")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.redo()} disabled={currentLocked}>
            <Redo2 className={ico} />
            {t(l, "menu.edit.redo")}
            <MenubarShortcut>{shortcut("Ctrl+Shift+Z")}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => s.copySelection()} disabled={!hasSelection}>
            <Copy className={ico} />
            {t(l, "menu.edit.copy")}
            <MenubarShortcut>{shortcut("Ctrl+C")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            onClick={() => s.paste()}
            disabled={s.clipboardCount === 0 || !hasImage || currentLocked}
          >
            <ClipboardPaste className={ico} />
            {t(l, "menu.edit.paste")}
            <MenubarShortcut>{shortcut("Ctrl+V")}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => s.selectAll()} disabled={!hasImage}>
            <CheckSquare className={ico} />
            {t(l, "menu.edit.selectAll")}
            <MenubarShortcut>{shortcut("Ctrl+A")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.clearSelection()} disabled={!hasSelection}>
            <XSquare className={ico} />
            {t(l, "menu.edit.clearSelection")}
            <MenubarShortcut>Esc</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.removeSelected()} disabled={!hasSelection || currentLocked}>
            <Trash2 className={ico} />
            {t(l, "menu.edit.deleteSelected")}
            <MenubarShortcut>Del</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={onSettings}>
            <SlidersHorizontal className={ico} />
            {t(l, "menu.settings")}
            <MenubarShortcut>{shortcut("Ctrl+,")}</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.view")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarItem
            onClick={() => {
              const state = useStore.getState();
              state.setZoom(state.zoom * 1.2);
            }}
            disabled={!hasImage}
          >
            <ZoomIn className={ico} />
            {t(l, "menu.view.zoomIn")}
            <MenubarShortcut>{shortcut("Ctrl+=")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            onClick={() => {
              const state = useStore.getState();
              state.setZoom(state.zoom / 1.2);
            }}
            disabled={!hasImage}
          >
            <ZoomOut className={ico} />
            {t(l, "menu.view.zoomOut")}
            <MenubarShortcut>{shortcut("Ctrl+-")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.requestFit("actual")} disabled={!hasImage}>
            {t(l, "menu.view.actual")}
            <MenubarShortcut>{shortcut("Ctrl+0")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.requestFit("window")} disabled={!hasImage}>
            {t(l, "menu.view.fitWindow")}
          </MenubarItem>
          <MenubarItem onClick={() => s.requestFit("width")} disabled={!hasImage}>
            {t(l, "menu.view.fitWidth")}
          </MenubarItem>

          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>{t(l, "menu.view.panels")}</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarCheckboxItem checked={s.view.fileList} onCheckedChange={() => s.toggleView("fileList")}>
                {t(l, "menu.view.showFileList")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem checked={s.view.results} onCheckedChange={() => s.toggleView("results")}>
                {t(l, "menu.view.showResults")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem checked={s.view.toolbar} onCheckedChange={() => s.toggleView("toolbar")}>
                {t(l, "menu.view.showToolbar")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem checked={s.view.statusBar} onCheckedChange={() => s.toggleView("statusBar")}>
                {t(l, "menu.view.showStatusBar")}
              </MenubarCheckboxItem>
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSub>
            <MenubarSubTrigger>{t(l, "menu.view.canvas")}</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarCheckboxItem checked={s.view.boxes} onCheckedChange={() => s.toggleView("boxes")}>
                {t(l, "menu.view.showBoxes")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem checked={s.view.labels} onCheckedChange={() => s.toggleView("labels")}>
                {t(l, "menu.view.showLabels")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem checked={s.view.highlight} onCheckedChange={() => s.toggleView("highlight")}>
                {t(l, "menu.view.highlight")}
              </MenubarCheckboxItem>
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSeparator />
          <MenubarItem onClick={() => win.toggleFullscreen()}>
            <Maximize className={ico} />
            {t(l, "menu.view.fullscreen")}
            <MenubarShortcut>F11</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.resetLayout()}>
            <RotateCcw className={ico} />
            {t(l, "menu.view.resetLayout")}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.model")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarSub>
            <MenubarSubTrigger>
              <ScanText className={ico} />
              {t(l, "menu.model.ocr")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={s.ocrModel} onValueChange={(v) => s.setOcrModel(v)}>
                {(modelOptions?.ocr_profiles ?? []).map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {o.title}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSub>
            <MenubarSubTrigger>
              <LayoutTemplate className={ico} />
              {t(l, "menu.model.layout")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={s.layoutModel} onValueChange={(v) => s.setLayoutModel(v)}>
                {(modelOptions?.layout_models ?? []).map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {o.title}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSub>
            <MenubarSubTrigger>
              <Sigma className={ico} />
              {t(l, "menu.model.formulaRecognition")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarLabel>{t(l, "menu.model.formulaRecognitionHint")}</MenubarLabel>
              <MenubarRadioGroup value={s.formulaModel} onValueChange={(v) => s.setFormulaModel(v)}>
                {(modelOptions?.formula_profiles ?? []).map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {o.title}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>

        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.help")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarItem onClick={() => openExternal(LINKS.docs)}>
            <BookOpen className={ico} />
            {t(l, "menu.help.docs")}
          </MenubarItem>
          <MenubarItem onClick={() => openExternal(LINKS.faq)}>
            <HelpCircle className={ico} />
            {t(l, "menu.help.faq")}
          </MenubarItem>
          <MenubarItem onClick={onShortcuts}>
            <Keyboard className={ico} />
            {t(l, "menu.help.shortcuts")}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => openExternal(LINKS.issues)}>
            <MessageSquare className={ico} />
            {t(l, "menu.help.feedback")}
          </MenubarItem>
          <MenubarItem onClick={() => openExternal(LINKS.releases)}>
            <RefreshCw className={ico} />
            {t(l, "menu.help.update")}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={onAbout}>
            <Info className={ico} />
            {t(l, "menu.help.about")}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
