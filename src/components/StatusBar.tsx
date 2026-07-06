import { Loader2, X } from "lucide-react";
import { modeLabel, t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { DEVICE_OPTIONS } from "@/types";

export function StatusBar() {
  const s = useStore();
  const l = s.locale;
  const img = s.currentImage();
  const total = s.images.length;
  const requestBatchCancel = useStore((st) => st.requestBatchCancel);
  const deviceLabel =
    DEVICE_OPTIONS.find((d) => d.key === s.device)?.label ?? s.device;
  const ocrModelTitle =
    s.modelOptions?.ocr_profiles.find((o) => o.key === s.ocrModel)?.title ??
    s.ocrModel;

  return (
    <div className="grid h-8 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t bg-card px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        {s.busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
        <span className={cn("truncate", s.statusMsg && "text-foreground/80")}>
          {s.statusMsg || t(l, "common.ready")}
        </span>
        {s.dirty && (
          <span className="shrink-0 rounded bg-status-warning px-1.5 py-0.5 text-status-warning-foreground">
            {t(l, "common.unsaved")}
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
          {s.modes.map((m) => modeLabel(l, m)).join(l === "zh-CN" ? "、" : " · ")}
        </span>
        <span className="truncate" title={ocrModelTitle}>
          {t(l, "statusbar.model")}
          {ocrModelTitle}
        </span>
        <span className="shrink-0">
          {t(l, "statusbar.device")}
          {deviceLabel}
        </span>
      </div>
    </div>
  );
}
