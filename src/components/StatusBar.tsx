import { Loader2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { modeLabel, t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { DEFAULT_DEVICE_OPTIONS } from "@/types";

export function StatusBar() {
  const s = useStore(
    useShallow((state) => {
      const img = state.currentImage();
      return {
        l: state.locale,
        img,
        currentIndex: state.currentIndex,
        total: state.images.length,
        currentImageDirty: img ? !!state.dirtyPaths[img.path] : false,
        busy: state.busy,
        statusMsg: state.statusMsg,
        dirty: state.dirty,
        batchRunning: state.batchRunning,
        batchCancelRequested: state.batchCancelRequested,
        zoom: state.zoom,
        mode: state.mode,
        modelOptions: state.modelOptions,
        ocrModel: state.ocrModel,
        layoutModel: state.layoutModel,
        formulaModel: state.formulaModel,
        device: state.device,
        deviceOptions: state.deviceOptions,
        requestBatchCancel: state.requestBatchCancel,
      };
    }),
  );
  const { l, img, total, currentImageDirty, requestBatchCancel } = s;
  const deviceOptions = s.deviceOptions.length ? s.deviceOptions : DEFAULT_DEVICE_OPTIONS;
  const deviceLabel =
    deviceOptions.find((d) => d.key === s.device)?.label ?? s.device;
  const activeMode = s.mode;
  const activeModelTitle =
    activeMode === "layout"
      ? (s.modelOptions?.layout_models.find((o) => o.key === s.layoutModel)?.title ??
        s.layoutModel)
      : activeMode === "formula"
        ? (s.modelOptions?.formula_profiles.find((o) => o.key === s.formulaModel)?.title ??
          s.formulaModel)
        : (s.modelOptions?.ocr_profiles.find((o) => o.key === s.ocrModel)?.title ??
          s.ocrModel);

  return (
    <div className="grid h-8 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t bg-card px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        {s.busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
        <span className={cn("truncate", s.statusMsg && "text-foreground/80")}>
          {s.statusMsg || t(l, "common.ready")}
        </span>
        {s.dirty && (
          <span className="shrink-0 rounded bg-status-warning px-1.5 py-0.5 text-status-warning-foreground">
            {t(l, currentImageDirty ? "common.unsaved" : "statusbar.otherImagesUnsaved")}
          </span>
        )}
        {s.batchRunning && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-5 shrink-0 gap-1 px-1.5 text-[11px]"
            onClick={requestBatchCancel}
            disabled={s.batchCancelRequested}
          >
            <X className="h-3 w-3" />
            {t(l, "common.cancel")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {img && (
          <>
            <span>
              {s.currentIndex + 1} / {total}
            </span>
            {img.width && img.height && (
              <span>
                {img.width} x {img.height}
              </span>
            )}
          </>
        )}
        <span>{Math.round(s.zoom * 100)}%</span>
      </div>

      <div className="flex min-w-0 justify-end gap-3">
        <span className="shrink-0">
          {t(l, "statusbar.mode")}
          {modeLabel(l, activeMode)}
        </span>
        <span className="truncate" title={activeModelTitle}>
          {t(l, "statusbar.model")}
          {activeModelTitle}
        </span>
        <span className="shrink-0">
          {t(l, "statusbar.device")}
          {deviceLabel}
        </span>
      </div>
    </div>
  );
}
