import { FolderOpen, Loader2 } from "lucide-react";
import { useState } from "react";
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
import { api, pickDirectory } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Kind = "detection" | "recognition";

const KINDS: { key: Kind; titleKey: MessageKey; descKey: MessageKey }[] = [
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
];

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const locale = useStore((s) => s.locale);
  const [kind, setKind] = useState<Kind>("detection");
  const [outDir, setOutDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const d = await pickDirectory(t(locale, "export.pickDir"));
    if (d) setOutDir(d);
  };

  const run = async () => {
    if (!outDir) return;
    setBusy(true);
    try {
      // Reading annotations across all images can throw (corrupt/missing
      // JSON); keep it inside the try so the error surfaces instead of
      // becoming an unhandled rejection with no UI feedback.
      const payload = await useStore.getState().exportableImages();

      if (payload.length === 0) {
        useStore.setState({ statusMsg: t(locale, "export.noAnnotations") });
        return;
      }

      const out = await api.exportDataset(payload, outDir, kind);
      useStore.setState({ statusMsg: tt(locale, "export.done", { path: out }) });
      onOpenChange(false);
    } catch (e) {
      useStore.setState({ statusMsg: `${t(locale, "export.failed")}: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, "export.title")}</DialogTitle>
          <DialogDescription>{t(locale, "export.desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {KINDS.map((k) => (
            <Button
              key={k.key}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={kind === k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                "h-auto flex-col items-start gap-1 p-3 text-left",
                kind === k.key ? "border-primary/40 bg-primary/10 text-primary" : "hover:bg-secondary",
              )}
            >
              <div className="text-sm font-medium">{t(locale, k.titleKey)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t(locale, k.descKey)}</div>
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={pick}>
            <FolderOpen className="h-4 w-4" />
            {t(locale, "export.pickDir")}
          </Button>
          <span className="flex-1 truncate text-xs text-muted-foreground" title={outDir ?? ""}>
            {outDir ?? t(locale, "export.noDir")}
          </span>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t(locale, "common.cancel")}
          </Button>
          <Button onClick={run} disabled={!outDir || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t(locale, "common.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
