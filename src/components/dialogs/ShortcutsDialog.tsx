import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useStore } from "@/store";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const locale = useStore((s) => s.locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(locale, "shortcuts.title")}</DialogTitle>
          <DialogDescription>{t(locale, "shortcuts.desc")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <dl className="divide-y divide-border">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between py-2">
                <dt className="text-sm text-foreground/80">{t(locale, s.descKey)}</dt>
                <dd>
                  <kbd className="rounded border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {s.keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}
