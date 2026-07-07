import { Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { isMac } from "@/lib/platform";
import { win } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

interface TitleBarProps {
  onClose: () => void;
}

// macOS uses the native traffic-light buttons (enabled via
// tauri.macos.conf.json: decorations:true + titleBarStyle:"Overlay"); we hide
// our custom controls there and only keep the drag region, reserving room on
// the left so the title never sits under the traffic lights. Windows/Linux keep
// the frameless window (decorations:false) and our custom min/max/close buttons.

// Shared look for the frameless window controls: flat, square, muted text with a
// consistent hover background. The close button overrides the hover color.
const windowBtn =
  "h-7 w-11 rounded-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground";

export function TitleBar({ onClose }: TitleBarProps) {
  const locale = useStore((s) => s.locale);

  return (
    <div
      // Tauri 2 uses the `data-tauri-drag-region` attribute (not CSS
      // -webkit-app-region) to make regions draggable. The whole bar is a
      // drag region; interactive controls inside opt out automatically (the
      // drag script skips buttons/links/role=button).
      data-tauri-drag-region
      className={cn(
        "flex h-7 items-center justify-between border-b bg-card",
        isMac ? "px-0" : "pl-3 pr-0",
      )}
    >
      {!isMac && (
        <div className="flex items-center">
          <span className="text-xs font-semibold tracking-tight text-foreground">oarlabel</span>
        </div>
      )}
      {/* On macOS the native traffic lights own the left; no brand block.
          On Windows/Linux we render the frameless min/max/close buttons. */}
      {!isMac && (
      <div className="flex items-center">
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
      )}
    </div>
  );
}
