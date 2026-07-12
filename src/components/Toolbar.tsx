import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileImage,
  FolderOpen,
  GripVertical,
  Hexagon,
  LayoutTemplate,
  MousePointer2,
  Save,
  ScanText,
  Sigma,
  Sparkles,
  SquareDashed,
  Upload,
} from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { BatchPreannotationDialog } from "@/components/dialogs/BatchPreannotationDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { modeLabel, t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { type Mode, type Tool } from "@/types";

export type ToolbarDock = "top" | "bottom" | "left" | "right";

interface ToolbarProps {
  onOpen: () => void;
  onExport: () => void;
  dock: ToolbarDock;
  onDockChange: (dock: ToolbarDock) => void;
}

const MODES: { key: Mode; icon: React.ReactNode }[] = [
  { key: "ocr", icon: <ScanText className="h-4 w-4" /> },
  { key: "layout", icon: <LayoutTemplate className="h-4 w-4" /> },
  { key: "formula", icon: <Sigma className="h-4 w-4" /> },
];

const TOOLS: { key: Tool; labelKey: MessageKey; icon: React.ReactNode }[] = [
  { key: "select", labelKey: "toolbar.edit", icon: <MousePointer2 className="h-4 w-4" /> },
  { key: "rect", labelKey: "toolbar.rect", icon: <SquareDashed className="h-4 w-4" /> },
  { key: "polygon", labelKey: "toolbar.polygon", icon: <Hexagon className="h-4 w-4" /> },
];

/** Tooltip side relative to the docked toolbar: vertical bars flank the canvas,
 *  so hints pop toward the center (right for left-dock, left for right-dock);
 *  horizontal bars sit above/below, so hints pop vertically. */
function tipSide(dock: ToolbarDock): "top" | "bottom" | "left" | "right" {
  if (dock === "left") return "right";
  if (dock === "right") return "left";
  if (dock === "bottom") return "top";
  return "bottom";
}

/** Wrap a single toolbar control in a hover tooltip. */
function Tip({
  label,
  side,
  children,
}: {
  label: string;
  side: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function nearestDock(x: number, y: number, width: number, height: number): ToolbarDock {
  const distances: Record<ToolbarDock, number> = {
    top: y,
    bottom: height - y,
    left: x,
    right: width - x,
  };
  return (Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0] as ToolbarDock);
}

function targetDock(x: number, y: number, width: number, height: number): ToolbarDock | null {
  const inset = 64;
  const thickness = 88;
  const inHorizontalRange = x >= inset && x <= width - inset;
  const inVerticalRange = y >= inset && y <= height - inset;

  if (inHorizontalRange && y <= thickness) return "top";
  if (inHorizontalRange && y >= height - thickness) return "bottom";
  if (inVerticalRange && x <= thickness) return "left";
  if (inVerticalRange && x >= width - thickness) return "right";
  return null;
}

export function Toolbar({ onOpen, onExport, dock, onDockChange }: ToolbarProps) {
  const s = useStore(
    useShallow((state) => ({
      l: state.locale,
      currentImage: state.currentImage(),
      busy: state.busy,
      batchRunning: state.batchRunning,
      batchPendingPaths: state.batchPendingPaths,
      currentIndex: state.currentIndex,
      imageCount: state.images.length,
      previousPath: state.images[state.currentIndex - 1]?.path,
      nextPath: state.images[state.currentIndex + 1]?.path,
      mode: state.mode,
      save: state.save,
      prev: state.prev,
      next: state.next,
      setMode: state.setMode,
      preannotateAll: state.preannotateAll,
      hasExistingAnnotations: state.images.some(
        (image) => image.status !== "pending" || !!state.annotationErrors[image.path],
      ),
      preannotateCurrent: state.preannotateCurrent,
    })),
  );
  const l = s.l;
  const currentImage = s.currentImage;
  const hasImage = !!currentImage;
  const currentLocked = s.busy || (!!currentImage && s.batchPendingPaths[currentImage.path] === true);
  const batchConflict = s.busy || s.batchRunning;
  const previousLocked = s.currentIndex <= 0
    || (!!s.previousPath && s.batchPendingPaths[s.previousPath] === true);
  const nextLocked = s.currentIndex < 0
    || s.currentIndex >= s.imageCount - 1
    || (!!s.nextPath && s.batchPendingPaths[s.nextPath] === true);
  const vertical = dock === "left" || dock === "right";
  // Horizontal toolbar: hide button captions below `xl` (≈1280px) so the bar
  // collapses to icon-only instead of wrapping/overflowing when the window is
  // near its 1024px minimum. Vertical layout always shows captions since its
  // buttons stack with no horizontal pressure; tooltips still label controls.
  const labelCls = vertical ? undefined : "hidden xl:inline";
  const [dragging, setDragging] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [guideDock, setGuideDock] = useState<ToolbarDock | null>(null);
  const [droppableDock, setDroppableDock] = useState<ToolbarDock | null>(null);

  const updateGuide = (x: number, y: number) => {
    if (x <= 0 && y <= 0) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    setGuideDock(nearestDock(x, y, width, height));
    setDroppableDock(targetDock(x, y, width, height));
  };

  const finishDockDrag = (x: number, y: number) => {
    const nextDock = targetDock(x, y, window.innerWidth, window.innerHeight);
    if (nextDock) onDockChange(nextDock);
    setDragging(false);
    setGuideDock(null);
    setDroppableDock(null);
  };

  const startDockDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(true);
    updateGuide(event.clientX, event.clientY);
  };

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      updateGuide(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      event.preventDefault();
      finishDockDrag(event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const side = tipSide(dock);
  const requestBatchPreannotation = () => {
    if (s.hasExistingAnnotations) setBatchDialogOpen(true);
    else void s.preannotateAll({ replacementConfirmed: true });
  };

  return (
    <>
      <div
        className={cn(
          "flex bg-card",
          vertical ? "h-full w-44 flex-col border-x" : "flex-col border-y",
        )}
      >
      <div
        className={cn(
          "flex gap-1 px-3 py-1.5",
          vertical ? "flex-col items-stretch" : "items-center",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={vertical ? "icon" : "default"}
              onPointerDown={startDockDrag}
              aria-label={t(l, "toolbar.drag")}
              className={cn(
                "cursor-grab active:cursor-grabbing",
                dragging && "border border-primary/40 bg-primary/10 text-primary",
                vertical && "h-8 w-full",
              )}
            >
              <GripVertical className="h-4 w-4" />
              {!vertical && <span className="sr-only">{t(l, "toolbar.drag")}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>{t(l, "toolbar.drag")}</TooltipContent>
        </Tooltip>
        <Tip label={t(l, "toolbar.open")} side={side}>
          <Button variant="ghost" className={cn("px-2", vertical && "w-full")} onClick={onOpen} disabled={batchConflict}>
            <FolderOpen className="h-4 w-4" />
            <span className={labelCls}>{t(l, "toolbar.open")}</span>
          </Button>
        </Tip>
        <Tip label={t(l, "toolbar.save")} side={side}>
          <Button variant="ghost" className={cn("px-2", vertical && "w-full")} onClick={() => s.save()} disabled={!hasImage || currentLocked}>
            <Save className="h-4 w-4" />
            <span className={labelCls}>{t(l, "toolbar.save")}</span>
          </Button>
        </Tip>

        <Separator orientation={vertical ? "horizontal" : "vertical"} className={cn(vertical ? "my-1" : "mx-2 h-7")} />
        <span className={cn("text-sm text-muted-foreground", vertical ? "px-1" : "px-1", labelCls)}>
          {t(l, "toolbar.mode")}
        </span>

        <ToggleGroup
          type="single"
          orientation={vertical ? "vertical" : "horizontal"}
          value={s.mode}
          onValueChange={(next) => {
            if (next) s.setMode(next as Mode);
          }}
          className={cn(vertical && "w-full flex-col")}
        >
          {MODES.map((m) => {
            const active = s.mode === m.key;
            return (
              <Tip key={m.key} label={modeLabel(l, m.key)} side={side}>
                <ToggleGroupItem
                  value={m.key}
                  aria-pressed={active}
                  // `data-active` is an explicit, self-controlled flag (not the
                  // Radix-managed data-state). Styled in index.css so it wins the
                  // cascade over the toggle's data-[state=off] classes — which is
                  // needed because Radix's data-state can fail to propagate when
                  // the tooltip trigger clones this item.
                  data-active={active ? "true" : undefined}
                  className={cn("px-2", vertical && "w-full")}
                >
                  {m.icon}
                  <span className={labelCls}>{modeLabel(l, m.key)}</span>
                </ToggleGroupItem>
              </Tip>
            );
          })}
        </ToggleGroup>

        <Separator orientation={vertical ? "horizontal" : "vertical"} className={cn(vertical ? "my-1" : "mx-2 h-7")} />
        <Tip label={t(l, "toolbar.export")} side={side}>
          <Button variant="ghost" className={cn("px-2", vertical && "w-full")} onClick={onExport} disabled={!s.imageCount || batchConflict}>
            <Upload className="h-4 w-4" />
            <span className={labelCls}>{t(l, "toolbar.export")}</span>
          </Button>
        </Tip>
      </div>

      <Separator />

      {vertical ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col items-stretch gap-1 px-3 py-1.5">
            <Tip label={t(l, "toolbar.previous")} side={side}>
              <Button variant="ghost" className="w-full px-2" onClick={() => s.prev()} disabled={s.busy || previousLocked}>
                <ArrowLeft className="h-4 w-4" />
                {t(l, "toolbar.previous")}
              </Button>
            </Tip>
            <Tip label={t(l, "toolbar.next")} side={side}>
              <Button
                variant="ghost"
                className="w-full px-2"
                onClick={() => s.next()}
                disabled={s.busy || nextLocked}
              >
                <ArrowRight className="h-4 w-4" />
                {t(l, "toolbar.next")}
              </Button>
            </Tip>

            <Separator orientation="horizontal" className="my-1" />

            <ToolGroup vertical side={side} />

            <Separator orientation="horizontal" className="my-1" />
            <Tip label={t(l, "toolbar.preannotateAll")} side={side}>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-full gap-1.5"
                onClick={requestBatchPreannotation}
                disabled={!s.imageCount || batchConflict}
              >
                <Sparkles className="h-4 w-4" />
                {t(l, "toolbar.preannotateAll")}
              </Button>
            </Tip>
            <Tip label={t(l, "toolbar.preannotateCurrent")} side={side}>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-full gap-1.5"
                onClick={() => s.preannotateCurrent()}
                disabled={!hasImage || batchConflict}
              >
                <FileImage className="h-4 w-4" />
                {t(l, "toolbar.preannotateCurrent")}
              </Button>
            </Tip>
          </div>
        </ScrollArea>
      ) : (
        <div className="flex items-center gap-1 px-3 py-1.5">
          <Tip label={t(l, "toolbar.previous")} side={side}>
            <Button variant="ghost" onClick={() => s.prev()} disabled={s.busy || previousLocked}>
              <ArrowLeft className="h-4 w-4" />
              <span className={labelCls}>{t(l, "toolbar.previous")}</span>
            </Button>
          </Tip>
          <Tip label={t(l, "toolbar.next")} side={side}>
            <Button
              variant="ghost"
              onClick={() => s.next()}
              disabled={s.busy || nextLocked}
            >
              <ArrowRight className="h-4 w-4" />
              <span className={labelCls}>{t(l, "toolbar.next")}</span>
            </Button>
          </Tip>

          <Separator orientation="vertical" className="mx-2 h-7" />

          <ToolGroup vertical={false} side={side} />

          <Separator orientation="vertical" className="mx-2 h-7" />
          <Tip label={t(l, "toolbar.preannotateAll")} side={side}>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5"
              onClick={requestBatchPreannotation}
              disabled={!s.imageCount || batchConflict}
            >
              <Sparkles className="h-4 w-4" />
              <span className={labelCls}>{t(l, "toolbar.preannotateAll")}</span>
            </Button>
          </Tip>
          <Tip label={t(l, "toolbar.preannotateCurrent")} side={side}>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => s.preannotateCurrent()}
              disabled={!hasImage || batchConflict}
            >
              <FileImage className="h-4 w-4" />
              <span className={labelCls}>{t(l, "toolbar.preannotateCurrent")}</span>
            </Button>
          </Tip>
        </div>
      )}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div className="absolute inset-x-16 top-3 flex h-16 justify-center">
            <DockGuide active={guideDock === "top"} droppable={droppableDock === "top"} label={t(l, "toolbar.dock.top")} />
          </div>
          <div className="absolute inset-x-16 bottom-3 flex h-16 justify-center">
            <DockGuide active={guideDock === "bottom"} droppable={droppableDock === "bottom"} label={t(l, "toolbar.dock.bottom")} />
          </div>
          <div className="absolute inset-y-16 left-3 flex w-16 items-center">
            <DockGuide active={guideDock === "left"} droppable={droppableDock === "left"} label={t(l, "toolbar.dock.left")} vertical />
          </div>
          <div className="absolute inset-y-16 right-3 flex w-16 items-center">
            <DockGuide active={guideDock === "right"} droppable={droppableDock === "right"} label={t(l, "toolbar.dock.right")} vertical />
          </div>
        </div>
      )}
      <BatchPreannotationDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        onConfirm={(skipAnnotated) =>
          void s.preannotateAll({ skipAnnotated, replacementConfirmed: true })
        }
      />
    </>
  );
}

/** Tool selector group. Rendered once and shared by the vertical/horizontal
 *  toolbar layouts so tooltips/styling stay in sync. */
function ToolGroup({ vertical, side }: { vertical: boolean; side: "top" | "bottom" | "left" | "right" }) {
  const s = useStore(
    useShallow((state) => ({
      l: state.locale,
      currentImage: state.currentImage(),
      busy: state.busy,
      batchPendingPaths: state.batchPendingPaths,
      tool: state.tool,
      setTool: state.setTool,
    })),
  );
  const l = s.l;
  const currentImage = s.currentImage;
  const hasImage = !!currentImage;
  const currentLocked = s.busy || (!!currentImage && s.batchPendingPaths[currentImage.path] === true);
  // Mirror the main toolbar: collapse captions to icon-only on narrow widths
  // for the horizontal layout; vertical always shows captions.
  const labelCls = vertical ? undefined : "hidden xl:inline";
  return (
    <ToggleGroup
      type="single"
      orientation={vertical ? "vertical" : "horizontal"}
      value={s.tool}
      onValueChange={(v) => {
        if (v) s.setTool(v as Tool);
      }}
      disabled={!hasImage || currentLocked}
      className={cn(vertical && "w-full flex-col")}
    >
      {TOOLS.map((tool) => {
        const active = s.tool === tool.key;
        return (
          <Tip key={tool.key} label={t(l, tool.labelKey)} side={side}>
            <ToggleGroupItem
              value={tool.key}
              aria-pressed={active}
              // Explicit active flag (same approach as the mode items): Radix's
              // data-state can fail to propagate under the Tooltip asChild clone,
              // so we drive the highlight ourselves from the real `s.tool`.
              data-active={active ? "true" : undefined}
              className={cn("px-2", vertical && "w-full")}
            >
              {tool.icon}
              <span className={labelCls}>{t(l, tool.labelKey)}</span>
            </ToggleGroupItem>
          </Tip>
        );
      })}
    </ToggleGroup>
  );
}

function DockGuide({
  active,
  droppable,
  label,
  vertical = false,
}: {
  active: boolean;
  droppable: boolean;
  label: string;
  vertical?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border border-dashed px-4 py-2 text-xs font-medium shadow-sm transition-colors",
        vertical ? "h-40 w-10 [writing-mode:vertical-rl]" : "h-10 min-w-40",
        droppable
          ? "border-status-success-foreground/50 bg-status-success text-status-success-foreground"
          : active
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-card/80 text-muted-foreground",
      )}
    >
      {droppable && <CheckCircle2 className="h-4 w-4" />}
      {label}
    </div>
  );
}
