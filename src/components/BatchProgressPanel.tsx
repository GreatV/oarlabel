import { Loader2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { t, tt } from "@/i18n";
import { useStore } from "@/store";

export function BatchProgressPanel() {
  const s = useStore(
    useShallow((state) => ({
      locale: state.locale,
      running: state.batchRunning,
      done: state.batchDone,
      total: state.batchTotal,
      failures: state.batchFailures,
      cancelRequested: state.batchCancelRequested,
      requestCancel: state.requestBatchCancel,
      clearFailures: state.clearBatchFailures,
    })),
  );
  if (!s.running && !s.failures.length) return null;

  const percent = s.total > 0 ? (s.done / s.total) * 100 : 0;
  const phaseLabel = s.running
    ? t(s.locale, "batch.preannotating")
    : t(s.locale, "batch.finishedWithFailures");

  return (
    <section
      className="fixed bottom-10 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-lg border bg-card p-4 text-sm shadow-xl"
      aria-live="polite"
      aria-label={t(s.locale, "batch.title")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 font-medium">
          {s.running && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
          <span className="truncate">{phaseLabel}</span>
        </div>
        {s.running ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0"
            onClick={s.requestCancel}
            disabled={s.cancelRequested}
          >
            {t(s.locale, "common.cancel")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={s.clearFailures}
            aria-label={t(s.locale, "batch.dismiss")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {s.running && (
        <div className="mt-3 space-y-1.5">
          <Progress value={percent} aria-label={phaseLabel} />
          <div className="text-right text-xs tabular-nums text-muted-foreground">
            {tt(s.locale, "batch.progress", { current: s.done, total: s.total })}
          </div>
        </div>
      )}

      {!!s.failures.length && (
        <div className="mt-3 border-t pt-3">
          <div className="mb-1.5 text-xs font-medium text-destructive">
            {tt(s.locale, "batch.failedCount", { count: s.failures.length })}
          </div>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {s.failures.map((failure, index) => (
              <li key={`${index}-${failure}`} className="break-words">
                {failure}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
