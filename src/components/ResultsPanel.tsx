import { ChevronDown, ChevronRight, FileText, ScanText } from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
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
import { resultLabel, resultReadingIndex, resultScore, resultText } from "@/types";
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

/** A row in the list — either a top-level region or a child (text/formula/
 * table line) nested under its region. Children are indented under their
 * parent and grouped with a collapsible header. */
interface Row {
  anno: Annotation;
  index: number; // position within the flat annotation list (for color/badge)
  depth: 0 | 1;
}

export function ResultsPanel({ width }: ResultsPanelProps) {
  const s = useStore();
  const l = s.locale;
  const annos = s.currentAnnos();
  // Which parent regions are collapsed. Lifted out of ResultRow because the
  // rows array is built here — collapsing must skip children at build time,
  // not just hide them after the fact.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  // Flatten the annotation list into render rows: parents first, then their
  // children, so the tree reads top-down. Top-level (parentless) annotations
  // that carry text are also valid rows (single-mode OCR output, manual boxes).
  const rows: Row[] = [];
  const childrenOf = new Map<string, Annotation[]>();
  for (const a of annos) {
    if (a.parentId) {
      const arr = childrenOf.get(a.parentId) ?? [];
      arr.push(a);
      childrenOf.set(a.parentId, arr);
    }
  }
  let flatIndex = 0;
  for (const a of annos) {
    if (a.parentId) continue; // rendered under its parent
    rows.push({ anno: a, index: flatIndex, depth: 0 });
    flatIndex++;
    // Skip a collapsed region's children. flatIndex still advances so color
    // badges of later regions stay stable when collapsing/expanding.
    if (collapsed.has(a.id)) {
      flatIndex += childrenOf.get(a.id)?.length ?? 0;
      continue;
    }
    const kids = childrenOf.get(a.id) ?? [];
    for (const k of kids) {
      rows.push({ anno: k, index: flatIndex, depth: 1 });
      flatIndex++;
    }
  }

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
            disabled={!annos.length || s.busy}
            onClick={() => s.recognizeAllTextBoxes()}
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
            rows.map(({ anno, index, depth }) => (
              <ResultRow
                key={anno.id}
                anno={anno}
                index={index}
                depth={depth}
                open={!collapsed.has(anno.id)}
                onToggleCollapse={() => toggleCollapse(anno.id)}
              />
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
  depth,
  open,
  onToggleCollapse,
}: {
  anno: Annotation;
  index: number;
  depth: 0 | 1;
  open: boolean;
  onToggleCollapse: () => void;
}) {
  const s = useStore();
  const l = s.locale;
  const color = colorFor(index);
  const selected = s.selectedIds.includes(anno.id);
  // Each annotation renders by its OWN data, not the global mode: a row that
  // carries recognized text (text/formula/table) shows an editable input;
  // a pure layout region shows its label + detection score.
  const hasText = anno.results.some((r) => r.task === "text_recognition");
  const label = resultLabel(anno);
  const isFormula = label === "formula";
  // In reading-order mode the badge shows the logical order index (1-based)
  // instead of the row position, so it matches the exported sequence.
  const readingIdx = resultReadingIndex(anno);
  const badge = readingIdx != null ? readingIdx + 1 : index + 1;
  const score = resultScore(anno);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={(e) => s.select(anno.id, e.ctrlKey || e.metaKey)}
          onContextMenu={() => {
            // Select the right-clicked row first so Copy/Delete below act on it.
            if (!selected) s.select(anno.id);
          }}
          className={cn(
            "result-row mb-1.5 flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 transition-colors",
            depth === 1 && "ml-4",
            anno.hidden && "opacity-55",
            selected ? "border-primary/40 bg-accent" : "border-transparent hover:bg-secondary",
          )}
        >
          <Checkbox
            checked={!anno.hidden}
            aria-label={t(l, "results.showBox")}
            className="mt-1"
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => s.setAnnotationHidden(anno.id, checked !== true)}
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
                placeholder={isFormula ? "LaTeX..." : t(l, "results.placeholder")}
                ariaLabel={isFormula ? "LaTeX" : t(l, "results.textTitle")}
                onCommit={(value) => s.setText(anno.id, value)}
              />
              <OriginalValue value={originalText(anno)} current={resultText(anno)} />
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-1.5 py-1 text-sm">
              {!anno.parentId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse();
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={open ? "collapse" : "expand"}
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
              <CommitLabelInput
                value={label ?? ""}
                placeholder={t(l, "results.region")}
                aria-label={t(l, "results.region")}
                onCommit={(value) => s.setLabel(anno.id, value)}
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
        <ContextMenuItem disabled={!selected} onClick={() => s.copySelection()}>
          {t(l, "menu.edit.copy")}
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.clipboard.length} onClick={() => s.paste()}>
          {t(l, "menu.edit.paste")}
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!hasText && (
          <ContextMenuItem onClick={() => s.ensureTextResult(anno.id)}>
            {t(l, "results.addText")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => s.recognizeSelectedText()} disabled={s.busy}>
          {t(l, "results.recognizeText")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => s.removeAnnotation(anno.id)}>
          {t(l, "toolbar.delete")}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => s.selectAll()}>
          {t(l, "menu.edit.selectAll")}
          <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.selectedIds.length} onClick={() => s.clearSelection()}>
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
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
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
