import { ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusLabel, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { type ImageStatus } from "@/types";

const badgeVariant: Record<ImageStatus, "outline" | "info" | "warning" | "success"> = {
  pending: "outline",
  preannotated: "info",
  labeling: "warning",
  done: "success",
};

interface FileListProps {
  collapsed: boolean;
  onToggle: () => void;
  width: number;
}

export function FileList({ collapsed, onToggle, width }: FileListProps) {
  const s = useStore();
  const l = s.locale;

  if (collapsed) {
    return (
      <div className="flex w-9 flex-col items-center border-r bg-sidebar pt-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={onToggle}
              aria-label={t(l, "fileList.expand")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t(l, "fileList.expand")}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-48 flex-col border-r bg-sidebar" style={{ width }}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">{t(l, "fileList.title")}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={onToggle}
              aria-label={t(l, "fileList.collapse")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(l, "fileList.collapse")}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-2">
          {s.images.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <FolderOpen className="h-8 w-8 text-muted-foreground/70" />
              <div className="text-sm font-medium text-foreground">{t(l, "fileList.emptyTitle")}</div>
              <p className="text-xs leading-5 text-muted-foreground">{t(l, "fileList.empty")}</p>
            </div>
          ) : (
            s.images.map((img, i) => {
              const active = i === s.currentIndex;
              return (
                <ContextMenu key={img.path}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "border border-primary/30 bg-primary/10" : "border border-transparent hover:bg-secondary",
                      )}
                      onClick={() => s.selectIndex(i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          s.selectIndex(i);
                        }
                      }}
                    >
                      <span className={cn("flex-1 truncate", active && "font-medium text-primary")} title={img.name}>
                        {img.name}
                      </span>
                      <Badge variant={badgeVariant[img.status]}>{statusLabel(l, img.status)}</Badge>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => s.selectIndex(i)}>
                      {t(l, "toolbar.open")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
