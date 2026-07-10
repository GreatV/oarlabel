import { FileText, ScanText } from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
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
import { t } from "@/i18n";
import { colorFor } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { resultLabel, resultScore, resultText } from "@/types";
import type { Annotation } from "@/types";

/** Suggested region labels offered as autocomplete options. Free text is still
 *  accepted — these are hints, not a closed set — so detector-emitted or
 *  user-defined labels aren't rejected. */
const LAYOUT_LABELS = ["region", "layout", "formula", "table", "figure", "text"];

function originalText(a: Annotation): string | undefined {
  const value = a.results.find((r) => r.task === "text_recognition")?.value.originalText;
  return typeof value === "string" ? value : undefined;
}

function originalLabel(a: Annotation): string | undefined {
  const value = a.results.find((r) => r.task === "layout_detection")?.value.originalLabel;
  return typeof value === "string" ? value : undefined;
}

interface ResultsPanelProps {
  width: number;
}

export function ResultsPanel({ width }: ResultsPanelProps) {
  const { l, annos, busy, recognizeAllTextBoxes } = useStore(
    useShallow((s) => ({
      l: s.locale,
      annos: s.currentAnnos(),
      busy: s.busy,
      recognizeAllTextBoxes: s.recognizeAllTextBoxes,
    })),
  );
  return (
    <div className="flex h-full min-w-64 flex-col border-l bg-card" style={{ width }}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">{t(l, "results.title.generic")}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2"
            disabled={!annos.length || busy}
            onClick={() => recognizeAllTextBoxes()}
          >
            <ScanText className="h-3.5 w-3.5" />
            {t(l, "results.recognizeAllText")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {annos.length} {t(l, "results.items")}
          </span>
        </div>
      </div>
      {/* Shared autocomplete source for the inline label editor in each row. */}
      <datalist id="oarlabel-layout-labels">
        {LAYOUT_LABELS.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
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
  );
}

function ResultRow({
  anno,
  index,
}: {
  anno: Annotation;
  index: number;
}) {
  const {
    l,
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
    removeAnnotation,
    selectAll,
    clearSelection,
  } = useStore(
    useShallow((s) => ({
      l: s.locale,
      selected: s.selectedIds.includes(anno.id),
      busy: s.busy,
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
      removeAnnotation: s.removeAnnotation,
      selectAll: s.selectAll,
      clearSelection: s.clearSelection,
    })),
  );
  const color = colorFor(index);
  // Each annotation renders by its OWN data, not the global mode: a row that
  // carries recognized text (text/formula/table) shows an editable input;
  // a pure layout region shows its label + detection score.
  const hasText = anno.results.some((r) => r.task === "text_recognition");
  const label = resultLabel(anno);
  const isFormula = label === "formula";
  const badge = index + 1;
  const score = resultScore(anno);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={(e) => select(anno.id, e.ctrlKey || e.metaKey)}
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
              <CommitLabelInput
                value={label ?? ""}
                disabled={busy}
                placeholder={t(l, "results.region")}
                aria-label={t(l, "results.region")}
                onCommit={(value) => setLabel(anno.id, value)}
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
        {!hasText && (
          <ContextMenuItem disabled={busy} onClick={() => ensureTextResult(anno.id)}>
            {t(l, "results.addText")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => recognizeSelectedText()} disabled={busy}>
          {t(l, "results.recognizeText")}
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
}

function FormulaPreview({ latex }: { latex: string }) {
  const html = useMemo(() => {
    if (!latex.trim()) return "";
    return katex.renderToString(latex, {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
    });
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
  const [draft, setDraft] = useState(value);
  const cancelRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
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
    if (draft !== value) onCommit(draft);
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          cancelRef.current = true;
          setDraft(value);
          e.currentTarget.blur();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.currentTarget.blur();
        }
      }}
      className="block min-h-0 w-full resize-none overflow-hidden rounded border border-input bg-card px-1.5 py-0 text-sm leading-5 shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function CommitLabelInput({
  value,
  placeholder,
  onCommit,
  ...props
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "list" | "value" | "placeholder" | "onChange" | "onCommit"
>) {
  const [draft, setDraft] = useState(value);
  const cancelRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      {...props}
      list="oarlabel-layout-labels"
      value={draft}
      placeholder={placeholder}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          cancelRef.current = true;
          setDraft(value);
          e.currentTarget.blur();
        } else if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-1.5 text-sm font-medium outline-none focus:border-primary"
    />
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
