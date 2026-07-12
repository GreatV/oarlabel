import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { useStore } from "@/store";

interface BatchPreannotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (skipAnnotated: boolean) => void;
}

export function BatchPreannotationDialog({
  open,
  onOpenChange,
  onConfirm,
}: BatchPreannotationDialogProps) {
  const locale = useStore((state) => state.locale);
  const [skipAnnotated, setSkipAnnotated] = useState(false);

  useEffect(() => {
    if (open) setSkipAnnotated(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(locale, "confirm.replaceAnnotations.title")}</DialogTitle>
          <DialogDescription>
            {t(locale, "confirm.replaceBatchAnnotations.message")}
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-secondary/30 p-3 text-sm">
          <Checkbox
            checked={skipAnnotated}
            onCheckedChange={(checked) => setSkipAnnotated(checked === true)}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium">{t(locale, "batch.skipAnnotated")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t(locale, "batch.skipAnnotatedDesc")}
            </span>
          </span>
        </label>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t(locale, "common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onConfirm(skipAnnotated);
            }}
          >
            {t(locale, "common.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
