import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { APP_VERSION, LINKS } from "@/lib/links";
import { openExternal } from "@/lib/tauri";
import { useStore } from "@/store";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const locale = useStore((s) => s.locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8" aria-hidden="true" />
            <DialogTitle className="text-lg">oarlabel</DialogTitle>
          </div>
          <DialogDescription>{t(locale, "about.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t(locale, "about.version")}</span>
            <span className="font-medium">v{APP_VERSION}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t(locale, "about.engine")}</span>
            <span className="font-medium">oar-ocr</span>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => openExternal(LINKS.repo)}
            className="w-full justify-between"
          >
            <span>{t(locale, "about.homepage")}</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
