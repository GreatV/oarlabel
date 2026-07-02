import { FileText } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { t, type MessageKey } from "@/i18n";
import { colorFor } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { resultLabel, resultScore, resultText } from "@/types";

const titleKeyByMode: Record<string, MessageKey> = {
  ocr: "results.title.ocr",
  reading: "results.title.reading",
  layout: "results.title.layout",
  formula: "results.title.formula",
  table: "results.title.table",
};

interface ResultsPanelProps {
  width: number;
}

export function ResultsPanel({ width }: ResultsPanelProps) {
  const s = useStore();
  const l = s.locale;
  const annos = s.currentAnnos();
  const showText = s.mode === "ocr" || s.mode === "reading";
  const titleKey = titleKeyByMode[s.mode] ?? "results.title.layout";

  return (
    <div className="flex h-full min-w-64 flex-col border-l bg-card" style={{ width }}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">
          {t(l, titleKey)}
        </span>
        <span className="text-xs text-muted-foreground">
          {annos.length} {t(l, "results.items")}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {annos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/70" />
              <div className="text-sm font-medium text-foreground">{t(l, "results.emptyTitle")}</div>
              <p className="text-xs leading-5 text-muted-foreground">{t(l, "results.empty")}</p>
            </div>
          ) : (
            annos.map((a, i) => {
              const color = colorFor(i);
              const selected = s.selectedIds.includes(a.id);
              return (
                <ContextMenu key={a.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={(e) => s.select(a.id, e.ctrlKey || e.metaKey)}
                      onContextMenu={() => {
                        // Select the right-clicked row first so Copy/Delete
                        // below act on it (matches the Edit menu semantics).
                        if (!selected) s.select(a.id);
                      }}
                      className={cn(
                        "result-row mb-1.5 flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 transition-colors",
                        selected ? "border-primary/40 bg-accent" : "border-transparent hover:bg-secondary",
                      )}
                    >
                      <span
                        className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {i + 1}
                      </span>
                      {showText ? (
                        <Input
                          value={resultText(a)}
                          placeholder={t(l, "results.placeholder")}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => s.setText(a.id, e.target.value)}
                          className="h-9 flex-1 text-base"
                        />
                      ) : (
                        <div className="flex-1 py-1 text-sm">
                          <span className="font-medium">{resultLabel(a) ?? t(l, "results.region")}</span>
                          {resultScore(a) != null && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {((resultScore(a) ?? 0) * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      disabled={!selected}
                      onClick={() => s.copySelection()}
                    >
                      {t(l, "menu.edit.copy")}
                      <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={!s.clipboard.length}
                      onClick={() => s.paste()}
                    >
                      {t(l, "menu.edit.paste")}
                      <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => s.removeAnnotation(a.id)}>
                      {t(l, "toolbar.delete")}
                      <ContextMenuShortcut>Del</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => s.selectAll()}>
                      {t(l, "menu.edit.selectAll")}
                      <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={!s.selectedIds.length}
                      onClick={() => s.clearSelection()}
                    >
                      {t(l, "menu.edit.clearSelection")}
                      <ContextMenuShortcut>Esc</ContextMenuShortcut>
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
