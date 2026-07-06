import {
  BookOpen,
  CheckSquare,
  ClipboardPaste,
  Clock,
  Copy,
  Cpu,
  FileImage,
  FileText,
  FolderOpen,
  Globe2,
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
  Sparkles,
  SunMoon,
  Table2,
  Trash2,
  Undo2,
  Upload,
  XSquare,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { LOCALE_OPTIONS, t } from "@/i18n";
import { LINKS } from "@/lib/links";
import { shortcut } from "@/lib/platform";
import { openExternal, pickImages, pickPdf, win } from "@/lib/tauri";
import { useStore } from "@/store";
import { DEVICE_OPTIONS, THEME_OPTIONS, type Device, type Theme } from "@/types";
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
import type { Locale } from "@/i18n";

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
  const s = useStore();
  const l = s.locale;
  const hasImage = !!s.currentImage();
  const hasSelection = s.selectedIds.length > 0;
  const modelOptions = s.modelOptions;

  const handleImportImages = async () => {
    const paths = await pickImages(t(l, "picker.images"), t(l, "picker.imageFilter"));
    if (paths.length) s.openFiles(paths);
  };
  const handleImportPdf = async () => {
    const pdf = await pickPdf(t(l, "picker.pdf"));
    if (pdf) s.openPdf(pdf);
  };

  return (
    <Menubar className="border-b bg-card px-2 py-1">
      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.file")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarItem onClick={handleImportImages}>
            <FileImage className={ico} />
            {t(l, "menu.file.importImages")}
          </MenubarItem>
          <MenubarItem onClick={onOpen}>
            <FolderOpen className={ico} />
            {t(l, "menu.file.importFolder")}
          </MenubarItem>
          <MenubarItem onClick={handleImportPdf}>
            <FileText className={ico} />
            {t(l, "menu.file.importPdf")}
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
                  <MenubarItem key={d} onClick={() => s.openFolder(d)} title={d}>
                    <span className="truncate">{baseName(d)}</span>
                  </MenubarItem>
                ))
              )}
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSeparator />
          <MenubarItem onClick={() => s.save()} disabled={!hasImage}>
            <Save className={ico} />
            {t(l, "menu.file.save")}
            <MenubarShortcut>{shortcut("Ctrl+S")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => void s.saveAndNext()} disabled={!hasImage}>
            {t(l, "menu.file.saveAndNext")}
            <MenubarShortcut>{shortcut("Ctrl+Enter")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={onExport} disabled={!s.images.length}>
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
          <MenubarItem onClick={() => s.undo()}>
            <Undo2 className={ico} />
            {t(l, "menu.edit.undo")}
            <MenubarShortcut>{shortcut("Ctrl+Z")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.redo()}>
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
            disabled={s.clipboard.length === 0 || !hasImage}
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
          <MenubarItem onClick={() => s.removeSelected()} disabled={!hasSelection}>
            <Trash2 className={ico} />
            {t(l, "menu.edit.deleteSelected")}
            <MenubarShortcut>Del</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.view")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarItem onClick={() => s.setZoom(s.zoom * 1.2)} disabled={!hasImage}>
            <ZoomIn className={ico} />
            {t(l, "menu.view.zoomIn")}
            <MenubarShortcut>{shortcut("Ctrl+=")}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => s.setZoom(s.zoom / 1.2)} disabled={!hasImage}>
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
          <MenubarLabel>{t(l, "menu.view.panels")}</MenubarLabel>
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

          <MenubarSeparator />
          <MenubarLabel>{t(l, "menu.view.canvas")}</MenubarLabel>
          <MenubarCheckboxItem checked={s.view.boxes} onCheckedChange={() => s.toggleView("boxes")}>
            {t(l, "menu.view.showBoxes")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={s.view.labels} onCheckedChange={() => s.toggleView("labels")}>
            {t(l, "menu.view.showLabels")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={s.view.highlight} onCheckedChange={() => s.toggleView("highlight")}>
            {t(l, "menu.view.highlight")}
          </MenubarCheckboxItem>

          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>
              <SunMoon className={ico} />
              {t(l, "menu.view.theme")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={s.theme} onValueChange={(v) => s.setTheme(v as Theme)}>
                {THEME_OPTIONS.map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {t(l, o.labelKey)}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
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

          <MenubarSub>
            <MenubarSubTrigger>
              <Table2 className={ico} />
              {t(l, "menu.model.tableRecognition")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarLabel>{t(l, "menu.model.tableRecognitionHint")}</MenubarLabel>
              <MenubarRadioGroup value={s.tableModel} onValueChange={(v) => s.setTableModel(v)}>
                {(modelOptions?.table_profiles ?? []).map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {o.title}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>
              <Cpu className={ico} />
              {t(l, "menu.model.device")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={s.device} onValueChange={(v) => s.setDevice(v as Device)}>
                {DEVICE_OPTIONS.map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {o.label}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>

          <MenubarSeparator />
          <MenubarItem onClick={() => s.preannotateAll()} disabled={!s.images.length || s.busy}>
            <Sparkles className={ico} />
            {t(l, "menu.model.preannotateAll")}
          </MenubarItem>
          <MenubarItem onClick={() => s.preannotateCurrent()} disabled={!hasImage || s.busy}>
            <FileImage className={ico} />
            {t(l, "menu.model.preannotateCurrent")}
          </MenubarItem>
          <MenubarItem onClick={onSettings}>
            <SlidersHorizontal className={ico} />
            {t(l, "menu.model.settings")}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>{t(l, "menu.help")}</MenubarTrigger>
        <MenubarContent className="min-w-[12rem]">
          <MenubarSub>
            <MenubarSubTrigger>
              <Globe2 className={ico} />
              {t(l, "menu.language")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={s.locale} onValueChange={(v) => s.setLocale(v as Locale)}>
                {LOCALE_OPTIONS.map((o) => (
                  <MenubarRadioItem key={o.key} value={o.key}>
                    {o.label}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem onClick={() => openExternal(LINKS.docs)}>
            <BookOpen className={ico} />
            {t(l, "menu.help.docs")}
          </MenubarItem>
          <MenubarItem onClick={() => openExternal(LINKS.faq)}>
            <HelpCircle className={ico} />
            {t(l, "menu.help.faq")}
          </MenubarItem>
          <MenubarItem onClick={() => openExternal(LINKS.issues)}>
            <MessageSquare className={ico} />
            {t(l, "menu.help.feedback")}
          </MenubarItem>
          <MenubarItem onClick={() => openExternal(LINKS.releases)}>
            <RefreshCw className={ico} />
            {t(l, "menu.help.update")}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={onShortcuts}>
            <Keyboard className={ico} />
            {t(l, "menu.help.shortcuts")}
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
