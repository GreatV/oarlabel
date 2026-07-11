import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  FolderOpen,
  GripVertical,
  PencilLine,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusLabel, t, type Locale } from "@/i18n";
import type { PanelSide } from "@/lib/panelDock";
import { cn } from "@/lib/utils";
import { virtualRange } from "@/lib/virtualList";
import { useStore } from "@/store";
import { type ImageItem, type ImageStatus } from "@/types";

const FILE_ROW_HEIGHT = 45;
const FILE_ROW_OVERSCAN = 8;

const statusAccent: Record<ImageStatus, string> = {
  pending: "bg-muted-foreground/40",
  preannotated: "bg-status-info",
  labeling: "bg-status-warning",
  done: "bg-status-success",
};

const statusIcon: Record<ImageStatus, { icon: LucideIcon; className: string }> = {
  pending: { icon: CircleDashed, className: "text-muted-foreground" },
  preannotated: { icon: Sparkles, className: "text-status-info" },
  labeling: { icon: PencilLine, className: "text-status-warning" },
  done: { icon: CheckCircle2, className: "text-status-success" },
};

interface FileListProps {
  collapsed: boolean;
  onToggle: () => void;
  side: PanelSide;
  onDockDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function FileList({
  collapsed,
  onToggle,
  side,
  onDockDragStart,
}: FileListProps) {
  const { images, currentIndex, busy, batchPendingPaths, l, annotationErrors, selectIndex } = useStore(
    useShallow((state) => ({
      images: state.images,
      currentIndex: state.currentIndex,
      busy: state.busy,
      batchPendingPaths: state.batchPendingPaths,
      l: state.locale,
      annotationErrors: state.annotationErrors,
      selectIndex: state.selectIndex,
    })),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () =>
      setViewport((current) => ({ ...current, height: element.clientHeight }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    setViewport((current) =>
      current.scrollTop === scrollTop ? current : { ...current, scrollTop },
    );
  };

  const { start, end } = virtualRange(
    images.length,
    FILE_ROW_HEIGHT,
    viewport.scrollTop,
    viewport.height,
    FILE_ROW_OVERSCAN,
  );

  if (collapsed) {
    return (
      <div className="flex h-20 w-full flex-col items-center bg-sidebar py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label={t(l, "layout.movePanel")}
          onPointerDown={onDockDragStart}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
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
              {side === "left" ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side === "left" ? "right" : "left"}>
            {t(l, "fileList.expand")}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">{t(l, "fileList.title")}</span>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 cursor-grab text-muted-foreground active:cursor-grabbing"
                onPointerDown={onDockDragStart}
                aria-label={t(l, "layout.movePanel")}
              >
                <GripVertical className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t(l, "layout.movePanel")}</TooltipContent>
          </Tooltip>
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
                {side === "left" ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t(l, "fileList.collapse")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={onScroll}
      >
        {images.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/70" />
            <div className="text-sm font-medium text-foreground">
              {t(l, "fileList.emptyTitle")}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t(l, "fileList.empty")}
            </p>
          </div>
        ) : (
          <div className="relative" style={{ height: images.length * FILE_ROW_HEIGHT }}>
            {images.slice(start, end).map((image, offset) => {
              const index = start + offset;
              return (
                <div
                  key={image.path}
                  className="absolute left-0 right-0 px-2"
                  style={{
                    top: index * FILE_ROW_HEIGHT,
                    height: FILE_ROW_HEIGHT,
                  }}
                >
                  <FileRow
                    image={image}
                    index={index}
                    active={index === currentIndex}
                    busy={busy || batchPendingPaths[image.path] === true}
                    error={annotationErrors[image.path]}
                    locale={l}
                    selectIndex={selectIndex}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const FileRow = memo(function FileRow({
  image,
  index,
  active,
  busy,
  error,
  locale,
  selectIndex,
}: {
  image: ImageItem;
  index: number;
  active: boolean;
  busy: boolean;
  error?: string;
  locale: Locale;
  selectIndex: (index: number) => Promise<void>;
}) {
  const StatusIcon = statusIcon[image.status].icon;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-disabled={busy}
          className={cn(
            "relative flex h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md border px-3 pl-4 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "border-primary/30 bg-primary/10"
              : "border-transparent hover:bg-secondary",
            busy && "cursor-not-allowed opacity-60",
          )}
          onClick={() => {
            if (!busy) void selectIndex(index);
          }}
          onKeyDown={(event) => {
            if (!busy && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              void selectIndex(index);
            }
          }}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute bottom-2 left-0 top-2 w-1 rounded-r-full",
              statusAccent[image.status],
            )}
          />
          <span
            className={cn("min-w-0 flex-1 truncate font-medium", active && "text-primary")}
            title={image.name}
          >
            {image.name}
          </span>
          {error && (
            <span
              role="img"
              aria-label={t(locale, "fileList.error")}
              title={error}
              className="shrink-0 text-destructive"
            >
              <TriangleAlert className="h-4 w-4" />
            </span>
          )}
          <span
            role="img"
            aria-label={statusLabel(locale, image.status)}
            title={statusLabel(locale, image.status)}
            className={cn("shrink-0", statusIcon[image.status].className)}
          >
            <StatusIcon className="h-4 w-4" />
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={busy} onClick={() => void selectIndex(index)}>
          {t(locale, "toolbar.open")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
