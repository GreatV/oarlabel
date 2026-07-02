import { Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { win } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

interface TitleBarProps {
  onClose: () => void;
}

// On macOS the native traffic-light buttons are expected; with `decorations:
// false` we hide our custom controls there and keep only the drag region.
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

// Shared look for the frameless window controls: flat, square, muted text with a
// consistent hover background. The close button overrides the hover color.
const windowBtn =
  "h-9 w-11 rounded-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground";

export function TitleBar({ onClose }: TitleBarProps) {
  const locale = useStore((s) => s.locale);

  return (
    <div className="drag-region flex h-9 items-center justify-between border-b bg-card pl-3 pr-0">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--brand-start))] to-[hsl(var(--brand-end))]">
          <div className="h-2 w-2 rounded-full bg-white/90" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">oarlabel</span>
      </div>
      {/* Reserve the drag region even when controls are hidden (macOS). */}
      <div className={cn("no-drag flex items-center", isMac && "pointer-events-none invisible w-px")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={windowBtn}
              onClick={() => win.minimize()}
              aria-label={t(locale, "common.minimize")}
            >
              <Minus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(locale, "common.minimize")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={windowBtn}
              onClick={() => win.toggleMaximize()}
              aria-label={t(locale, "common.maximize")}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(locale, "common.maximize")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={cn(windowBtn, "hover:bg-destructive hover:text-destructive-foreground")}
              onClick={onClose}
              aria-label={t(locale, "common.close")}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(locale, "common.close")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
