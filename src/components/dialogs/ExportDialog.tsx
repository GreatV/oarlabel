import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t, tt, type MessageKey } from "@/i18n";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { ExportKind } from "@/types";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KINDS: { key: ExportKind; titleKey: MessageKey; descKey: MessageKey }[] = [
  {
    key: "detection",
    titleKey: "export.detectionTitle",
    descKey: "export.detectionDesc",
  },
  {
    key: "recognition",
    titleKey: "export.recognitionTitle",
    descKey: "export.recognitionDesc",
  },
  {
    key: "formula",
    titleKey: "export.formulaTitle",
    descKey: "export.formulaDesc",
  },
  {
    key: "layout",
    titleKey: "export.layoutTitle",
    descKey: "export.layoutDesc",
  },
];

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const {
    locale,
    exportRunning,
    exportTotal,
    exportDone,
    exportCancelRequested,
    requestExportCancel,
  } = useStore(
    useShallow((s) => ({
      locale: s.locale,
      exportRunning: s.exportRunning,
      exportTotal: s.exportTotal,
      exportDone: s.exportDone,
      exportCancelRequested: s.exportCancelRequested,
      requestExportCancel: s.requestExportCancel,
    })),
  );
  const [kind, setKind] = useState<ExportKind>("detection");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (useStore.getState().busy) {
      useStore.setState({ statusMsg: t(locale, "export.busy") });
      return;
    }

    setBusy(true);
    useStore.setState({ busy: true });
    try {
      const outDir = await api.pickExportDirectory(t(locale, "export.pickDir"));
      if (!outDir) {
        useStore.setState({ statusMsg: t(locale, "message.exportCancelled") });
        return;
      }

      useStore.setState({ busy: true, statusMsg: t(locale, "message.exporting") });

      // Reading annotations across all images can throw (corrupt/missing
      // JSON); keep it inside the try so the error surfaces instead of
      // becoming an unhandled rejection with no UI feedback.
      const payload = await useStore.getState().exportableImages(kind);

      if (payload === null) {
        useStore.setState({ statusMsg: t(locale, "message.exportCancelled") });
        return;
      }

      const { exportSourceFailures, exportSourceSkipped } = useStore.getState();
      const sourceDetails = exportSourceFailures.length
        ? tt(locale, "export.sourceSkipped", {
            count: exportSourceSkipped,
            files: exportSourceFailures.slice(0, 3).join("; "),
          })
        : exportSourceSkipped > 0
          ? tt(locale, "export.sourceEntriesSkipped", { count: exportSourceSkipped })
          : "";

      if (payload.length === 0) {
        useStore.setState({ statusMsg: sourceDetails || t(locale, "export.noAnnotations") });
        return;
      }

      const out = await api.exportDataset(payload, outDir, kind);
      const done = tt(locale, "export.done", { path: out.path });
      useStore.setState({
        statusMsg: [
          done,
          out.skipped > 0 ? tt(locale, "export.skipped", { count: out.skipped }) : "",
          sourceDetails,
        ]
          .filter(Boolean)
          .join(locale === "zh-CN" ? "；" : ", "),
      });
      onOpenChange(false);
    } catch (e) {
      useStore.setState({ statusMsg: `${t(locale, "export.failed")}: ${String(e)}` });
    } finally {
      setBusy(false);
      useStore.setState({ busy: false });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy || next) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto sm:min-h-[26rem]">
        <DialogHeader>
          <DialogTitle>{t(locale, "export.title")}</DialogTitle>
          <DialogDescription>{t(locale, "export.desc")}</DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          role="radiogroup"
          aria-label={t(locale, "export.title")}
        >
          {KINDS.map((k) => (
            <Button
              key={k.key}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={kind === k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                "h-full min-h-28 min-w-0 flex-col items-start justify-start gap-1 whitespace-normal p-3 text-left",
                kind === k.key ? "border-primary/40 bg-primary/10 text-primary" : "hover:bg-secondary",
              )}
            >
              <div className="w-full min-w-0 break-words text-sm font-medium leading-5">{t(locale, k.titleKey)}</div>
              <div className="mt-1 w-full min-w-0 break-words text-xs leading-5 text-muted-foreground">
                {t(locale, k.descKey)}
              </div>
            </Button>
          ))}
        </div>

        {exportRunning && (
          <div className="text-xs text-muted-foreground">
            {tt(locale, "export.collectingProgress", {
              current: exportDone,
              total: exportTotal,
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              if (exportRunning) requestExportCancel();
              else onOpenChange(false);
            }}
            disabled={busy && (!exportRunning || exportCancelRequested)}
          >
            {t(locale, "common.cancel")}
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t(locale, "common.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
