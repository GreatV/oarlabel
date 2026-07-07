import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { api, pickFile } from "@/lib/tauri";
import { useStore } from "@/store";
import type { CustomOcrPaths } from "@/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CUSTOM_OCR_PROFILE_KEY = "custom_text_ocr";

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const locale = useStore((s) => s.locale);
  const minBoxSize = useStore((s) => s.minBoxSize);
  const setMinBoxSize = useStore((s) => s.setMinBoxSize);
  const inferenceTuning = useStore((s) => s.inferenceTuning);
  const setInferenceTuning = useStore((s) => s.setInferenceTuning);
  const refreshModels = useStore((s) => s.refreshModels);
  const setOcrModel = useStore((s) => s.setOcrModel);
  const [customPaths, setCustomPaths] = useState<CustomOcrPaths>({
    textDetectionModelPath: "",
    textRecognitionModelPath: "",
    textRecognitionDictPath: "",
  });

  useEffect(() => {
    if (!open) return;
    api
      .readCustomOcrPaths()
      .then(setCustomPaths)
      .catch((e) => {
        useStore.setState({
          statusMsg: `${t(locale, "settings.readCustomModelFailed")}: ${String(e)}`,
        });
      });
  }, [open, locale]);

  const saveCustomPaths = async (paths: CustomOcrPaths) => {
    try {
      await api.saveCustomOcrPaths(paths);
      await refreshModels();
      const hasCustomProfile =
        useStore
          .getState()
          .modelOptions?.ocr_profiles.some((profile) => profile.key === CUSTOM_OCR_PROFILE_KEY) ??
        false;
      if (hasCustomProfile) {
        setOcrModel(CUSTOM_OCR_PROFILE_KEY);
      }
      useStore.setState({ statusMsg: t(locale, "settings.customModelSaved") });
    } catch (e) {
      useStore.setState({
        statusMsg: `${t(locale, "settings.customModelSaveFailed")}: ${String(e)}`,
      });
    }
  };

  const updateCustomPath = (key: keyof CustomOcrPaths, value: string) => {
    setCustomPaths((paths) => ({ ...paths, [key]: value }));
  };

  const chooseCustomPath = async (
    key: keyof CustomOcrPaths,
    title: string,
    extensions?: string[],
  ) => {
    const path = await pickFile(title, extensions);
    if (!path) return;
    const next = { ...customPaths, [key]: path };
    setCustomPaths(next);
    await saveCustomPaths(next);
  };

  const updateTextDetectionTuning = (key: string, value: number) => {
    setInferenceTuning({
      ...inferenceTuning,
      ocr: { ...inferenceTuning.ocr, [key]: value },
    });
  };

  const updateTextRecognitionTuning = (key: string, value: number) => {
    setInferenceTuning({
      ...inferenceTuning,
      text_recognition: { ...inferenceTuning.text_recognition, [key]: value },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(locale, "settings.title")}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-medium">{t(locale, "settings.annotationTitle")}</div>
              <div className="text-xs text-muted-foreground">
                {t(locale, "settings.minBoxSizeDesc")}
              </div>
            </div>
            <Input
              className="w-24"
              type="number"
              min={1}
              max={128}
              step={1}
              value={minBoxSize}
              aria-label={t(locale, "settings.minBoxSize")}
              onChange={(e) => setMinBoxSize(e.target.valueAsNumber)}
            />
          </div>
          <div className="mb-3 border-b pb-3">
            <div className="mb-3">
              <div className="text-sm font-medium">{t(locale, "settings.textParamsTitle")}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ThresholdNumber
                label={t(locale, "settings.ocrScoreThreshold")}
                value={inferenceTuning.ocr.score_threshold ?? 0}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateTextDetectionTuning("score_threshold", value)}
              />
              <ThresholdNumber
                label={t(locale, "settings.ocrBoxThreshold")}
                value={inferenceTuning.ocr.box_threshold ?? 0}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateTextDetectionTuning("box_threshold", value)}
              />
              <ThresholdNumber
                label={t(locale, "settings.ocrUnclipRatio")}
                value={inferenceTuning.ocr.unclip_ratio ?? 0}
                min={0}
                max={10}
                step={0.1}
                onChange={(value) => updateTextDetectionTuning("unclip_ratio", value)}
              />
              <ThresholdNumber
                label={t(locale, "settings.textRecognitionScoreThreshold")}
                value={inferenceTuning.text_recognition.score_threshold ?? 0}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateTextRecognitionTuning("score_threshold", value)}
              />
            </div>
          </div>
          <div className="mb-2">
            <div>
              <div className="text-sm font-medium">{t(locale, "settings.customTitle")}</div>
              <div className="text-xs text-muted-foreground">
                {t(locale, "settings.customDesc")}
              </div>
            </div>
          </div>
          <div className="grid gap-3">
            <PathInput
              label={t(locale, "settings.customTextDetectionModel")}
              value={customPaths.textDetectionModelPath}
              onChange={(value) => updateCustomPath("textDetectionModelPath", value)}
              onCommit={() => saveCustomPaths(customPaths)}
              onBrowse={() =>
                chooseCustomPath(
                  "textDetectionModelPath",
                  t(locale, "settings.customTextDetectionModel"),
                  ["onnx"],
                )
              }
              browseLabel={t(locale, "settings.chooseFile")}
            />
            <PathInput
              label={t(locale, "settings.customTextRecognitionModel")}
              value={customPaths.textRecognitionModelPath}
              onChange={(value) => updateCustomPath("textRecognitionModelPath", value)}
              onCommit={() => saveCustomPaths(customPaths)}
              onBrowse={() =>
                chooseCustomPath(
                  "textRecognitionModelPath",
                  t(locale, "settings.customTextRecognitionModel"),
                  ["onnx"],
                )
              }
              browseLabel={t(locale, "settings.chooseFile")}
            />
            <PathInput
              label={t(locale, "settings.customTextRecognitionDict")}
              value={customPaths.textRecognitionDictPath}
              onChange={(value) => updateCustomPath("textRecognitionDictPath", value)}
              onCommit={() => saveCustomPaths(customPaths)}
              onBrowse={() =>
                chooseCustomPath(
                  "textRecognitionDictPath",
                  t(locale, "settings.customTextRecognitionDict"),
                  ["txt"],
                )
              }
              browseLabel={t(locale, "settings.chooseFile")}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PathInput({
  label,
  value,
  browseLabel,
  onChange,
  onCommit,
  onBrowse,
}: {
  label: string;
  value: string;
  browseLabel: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onBrowse: () => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      <span>{label}</span>
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1 font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label={browseLabel}
          title={browseLabel}
          onClick={onBrowse}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </label>
  );
}
function ThresholdNumber({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      <span>{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const value = e.target.valueAsNumber;
          onChange(Number.isFinite(value) ? value : min);
        }}
      />
    </label>
  );
}
