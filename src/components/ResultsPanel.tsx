import { ChevronLeft, ChevronRight, FileText, GripVertical, ScanText } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { layoutLabelOptions } from "@/lib/layoutLabels";
import { colorFor } from "@/lib/palette";
import type { PanelSide } from "@/lib/panelDock";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { resultLabel, resultScore, resultText } from "@/types";
import type { Annotation } from "@/types";

function originalText(a: Annotation): string | undefined {
  const value = a.results.find((r) => r.task === "text_recognition")?.value.originalText;
  return typeof value === "string" ? value : undefined;
}

function originalLabel(a: Annotation): string | undefined {
  const value = a.results.find((r) => r.task === "layout_detection")?.value.originalLabel;
  return typeof value === "string" ? value : undefined;
}

interface ResultsPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  side: PanelSide;
  onDockDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function ResultsPanel({ collapsed, onToggle, side, onDockDragStart }: ResultsPanelProps) {
  const { l, annos, busy, batchRunning, mode, recognizeAllTextBoxes } = useStore(
    useShallow((s) => {
      const path = s.currentImage()?.path;
      return {
        l: s.locale,
        annos: s.currentAnnos(),
        busy: s.busy || (!!path && s.batchPendingPaths[path] === true),
        batchRunning: s.batchRunning,
        mode: s.mode,
        recognizeAllTextBoxes: s.recognizeAllTextBoxes,
      };
    }),
  );

  if (collapsed) {
    return (
      <div className="flex h-20 w-full flex-col items-center bg-card py-2">
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
              aria-label={t(l, "results.expand")}
            >
              {side === "left" ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side === "left" ? "right" : "left"}>
            {t(l, "results.expand")}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">{t(l, "results.title.generic")}</span>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
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
                aria-label={t(l, "results.collapse")}
              >
                {side === "left" ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t(l, "results.collapse")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="px-2 pb-3" role="listbox" aria-multiselectable="true">
                {annos.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <FileText className="h-8 w-8 text-muted-foreground/70" />
                    <div className="text-sm font-medium text-foreground">{t(l, "results.emptyTitle")}</div>
                    <p className="text-xs leading-5 text-muted-foreground">{t(l, "results.empty")}</p>
                  </div>
                ) : (
                  annos.map((anno, index) => (
                    <ResultRow key={anno.id} anno={anno} index={index} />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!annos.length || busy || batchRunning || mode === "layout"}
            onClick={() => void recognizeAllTextBoxes()}
          >
            <ScanText className="h-4 w-4 text-muted-foreground" />
            {t(l, "results.recognizeAllText")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

const ResultRow = memo(function ResultRow({
  anno,
  index,
}: {
  anno: Annotation;
  index: number;
}) {
  const {
    l,
    mode,
    batchRunning,
    selected,
    busy,
    clipboardCount,
    selectionCount,
    select,
    setAnnotationHidden,
    setText,
    setLabel,
    copySelection,
    paste,
    ensureTextResult,
    recognizeSelectedText,
    recognizeAllTextBoxes,
    removeAnnotation,
    selectAll,
    clearSelection,
  } = useStore(
    useShallow((s) => {
      const path = s.currentImage()?.path;
      return {
        l: s.locale,
        mode: s.mode,
        batchRunning: s.batchRunning,
        selected: s.selectedIds.includes(anno.id),
        busy: s.busy || (!!path && s.batchPendingPaths[path] === true),
        clipboardCount: s.clipboard.length,
        selectionCount: s.selectedIds.length,
        select: s.select,
        setAnnotationHidden: s.setAnnotationHidden,
        setText: s.setText,
        setLabel: s.setLabel,
        copySelection: s.copySelection,
        paste: s.paste,
        ensureTextResult: s.ensureTextResult,
        recognizeSelectedText: s.recognizeSelectedText,
        recognizeAllTextBoxes: s.recognizeAllTextBoxes,
        removeAnnotation: s.removeAnnotation,
        selectAll: s.selectAll,
        clearSelection: s.clearSelection,
      };
    }),
  );
  const color = colorFor(index);
  // Each annotation renders by its OWN data, not the global mode: a row that
  // carries recognized text (text/formula/table) shows an editable input;
  // a pure layout region shows its label + detection score.
  const hasText = anno.results.some((r) => r.task === "text_recognition");
  const hasLayoutLabel = anno.results.some((r) => r.task === "layout_detection");
  const label = resultLabel(anno);
  const isFormula = label === "formula";
  const badge = index + 1;
  const score = resultScore(anno);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="option"
          aria-selected={selected}
          tabIndex={0}
          onClick={(e) => select(anno.id, e.ctrlKey || e.metaKey)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            select(anno.id, e.ctrlKey || e.metaKey);
          }}
          onContextMenu={() => {
            // Select the right-clicked row first so Copy/Delete below act on it.
            if (!selected) select(anno.id);
          }}
          className={cn(
            "result-row mb-1.5 flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 transition-colors",
            anno.hidden && "opacity-55",
            selected ? "border-primary/40 bg-accent" : "border-transparent hover:bg-secondary",
          )}
        >
          <Checkbox
            checked={!anno.hidden}
            disabled={busy}
            aria-label={t(l, "results.showBox")}
            className="mt-1"
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => setAnnotationHidden(anno.id, checked !== true)}
          />
          <span
            className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {badge}
          </span>
          {hasText ? (
            <div className="min-w-0 flex-1">
              {hasLayoutLabel && (
                <div className="mb-1 flex items-center gap-1.5">
                  <LayoutLabelSelect
                    value={label ?? "region"}
                    disabled={busy}
                    ariaLabel={t(l, "results.region")}
                    onChange={(value) => setLabel(anno.id, value)}
                  />
                  {score != null && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(score * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
              {isFormula && <FormulaPreview latex={resultText(anno)} />}
              <CommitTextarea
                value={resultText(anno)}
                disabled={busy}
                placeholder={isFormula ? "LaTeX..." : t(l, "results.placeholder")}
                ariaLabel={isFormula ? "LaTeX" : t(l, "results.textTitle")}
                onCommit={(value) => setText(anno.id, value)}
              />
              <OriginalValue value={originalText(anno)} current={resultText(anno)} />
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-1.5 py-1 text-sm">
              <LayoutLabelSelect
                value={label ?? "region"}
                disabled={busy}
                ariaLabel={t(l, "results.region")}
                onChange={(value) => setLabel(anno.id, value)}
              />
              {score != null && (
                <span className="text-xs text-muted-foreground">{(score * 100).toFixed(1)}%</span>
              )}
              <OriginalValue value={originalLabel(anno)} current={label ?? ""} />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!selected} onClick={() => copySelection()}>
          {t(l, "menu.edit.copy")}
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={busy || !clipboardCount} onClick={() => paste()}>
          {t(l, "menu.edit.paste")}
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!hasText && mode !== "layout" && (
          <ContextMenuItem disabled={busy} onClick={() => ensureTextResult(anno.id)}>
            {t(l, "results.addText")}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => recognizeSelectedText()}
          disabled={busy || batchRunning || mode === "layout"}
        >
          {t(l, "results.recognizeText")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => recognizeAllTextBoxes()}
          disabled={busy || batchRunning || mode === "layout"}
        >
          {t(l, "results.recognizeAllText")}
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onClick={() => removeAnnotation(anno.id)}>
          {t(l, "toolbar.delete")}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => selectAll()}>
          {t(l, "menu.edit.selectAll")}
          <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!selectionCount} onClick={() => clearSelection()}>
          {t(l, "menu.edit.clearSelection")}
          <ContextMenuShortcut>Esc</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

let katexPromise: Promise<typeof import("katex").default> | null = null;

function loadKatex() {
  katexPromise ??= Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([module]) => module.default);
  return katexPromise;
}

function FormulaPreview({ latex }: { latex: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    setHtml("");
    if (!latex.trim()) return;
    void loadKatex()
      .then((katex) => {
        if (cancelled) return;
        setHtml(
          katex.renderToString(latex, {
            displayMode: true,
            throwOnError: false,
            strict: "ignore",
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [latex]);

  if (!html) return null;
  return (
    <div
      className="mb-1 overflow-x-auto rounded border border-border bg-background px-2 py-1.5 text-center"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CommitTextarea({
  value,
  disabled,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
}) {
  const withoutLineBreaks = (text: string) => text.replace(/[\r\n]+/g, " ");
  const [draft, setDraft] = useState(() => withoutLineBreaks(value));
  const cancelRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(withoutLineBreaks(value));
  }, [value]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    if (draft !== withoutLineBreaks(value)) onCommit(draft);
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      dir="auto"
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(withoutLineBreaks(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          cancelRef.current = true;
          setDraft(withoutLineBreaks(value));
          e.currentTarget.blur();
        } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="block min-h-0 w-full resize-none overflow-hidden rounded border border-input bg-card px-1.5 py-0 text-sm leading-5 shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function LayoutLabelSelect({
  value,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const options = layoutLabelOptions(value);

  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm font-medium outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function OriginalValue({ value, current }: { value: string | undefined; current: string }) {
  const locale = useStore((s) => s.locale);
  if (value == null || value === current) return null;
  return (
    <div className="mt-1 rounded border border-dashed px-2 py-1 text-xs leading-5 text-muted-foreground">
      <span className="font-medium">{t(locale, "results.original")} </span>
      <span className="whitespace-pre-wrap break-words">{value}</span>
    </div>
  );
}
