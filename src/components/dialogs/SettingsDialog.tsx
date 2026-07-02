import { CheckCircle2, Cloud, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api } from "@/lib/tauri";
import { useStore } from "@/store";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const models = useStore((s) => s.models);
  const locale = useStore((s) => s.locale);
  const refreshModels = useStore((s) => s.refreshModels);
  const [configText, setConfigText] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (!open) return;
    refreshModels();
    api
      .readModelConfig()
      .then(setConfigText)
      .catch((e) => {
        useStore.setState({
          statusMsg: `${t(locale, "settings.readConfigFailed")}: ${String(e)}`,
        });
      });
  }, [open, refreshModels, locale]);

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.saveModelConfig(configText);
      await refreshModels();
      useStore.setState({ statusMsg: t(locale, "settings.configSaved") });
    } catch (e) {
      useStore.setState({
        statusMsg: `${t(locale, "settings.configSaveFailed")}: ${String(e)}`,
      });
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(locale, "settings.title")}</DialogTitle>
          <DialogDescription>{t(locale, "settings.desc")}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{t(locale, "settings.customTitle")}</div>
              <div className="text-xs text-muted-foreground">
                {t(locale, "settings.customDesc")}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t(locale, "settings.saveConfig")}
            </Button>
          </div>
          <Textarea
            className="h-36 resize-none font-mono text-xs"
            spellCheck={false}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
          />
        </div>

        <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
          {models.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t(locale, "settings.loading")}
            </p>
          )}
          {models.map((m) => (
            <div key={m.key} className="rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{m.title}</span>
                    {m.bundled && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t(locale, "common.bundled")}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.filename} - {m.size_label}
                  </div>
                </div>
                {m.present ? (
                  <span className="flex items-center gap-1 text-xs text-status-success-foreground">
                    <CheckCircle2 className="h-4 w-4" /> {t(locale, "common.available")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Cloud className="h-4 w-4" /> {t(locale, "settings.autoDownload")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
