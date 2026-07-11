import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOCALE_OPTIONS, t, type Locale } from "@/i18n";
import { api, pickFile } from "@/lib/tauri";
import { useStore } from "@/store";
import {
  DEFAULT_DEVICE_OPTIONS,
  THEME_OPTIONS,
  type CustomOcrPaths,
  type Device,
  type Theme,
} from "@/types";

export type SettingsSection = "general" | "annotation" | "models";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

const CUSTOM_OCR_PROFILE_KEY = "custom_text_ocr";

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection = "general",
}: SettingsDialogProps) {
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const device = useStore((s) => s.device);
  const deviceOptionsFromStore = useStore((s) => s.deviceOptions);
  const setDevice = useStore((s) => s.setDevice);
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
  const [customPathsLoading, setCustomPathsLoading] = useState(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<SettingsSection, HTMLElement | null>>({
    general: null,
    annotation: null,
    models: null,
  });
  const deviceOptions = deviceOptionsFromStore.length
    ? deviceOptionsFromStore
    : DEFAULT_DEVICE_OPTIONS;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      const target = sectionRefs.current[initialSection];
      if (!container || !target) return;
      container.scrollTo({
        top: initialSection === "general" ? 0 : target.offsetTop - container.offsetTop,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCustomPathsLoading(true);
    api
      .readCustomOcrPaths()
      .then((paths) => {
        if (!cancelled) setCustomPaths(paths);
      })
      .catch((e) => {
        if (cancelled) return;
        useStore.setState({
          statusMsg: `${t(useStore.getState().locale, "settings.readCustomModelFailed")}: ${String(e)}`,
        });
      })
      .finally(() => {
        if (!cancelled) setCustomPathsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const persistCustomPaths = async (paths: CustomOcrPaths) => {
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

  const saveCustomPaths = (paths: CustomOcrPaths): Promise<void> => {
    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(() => persistCustomPaths(paths));
    saveQueueRef.current = queued.catch(() => undefined);
    return queued;
  };

  const updateCustomPath = (key: keyof CustomOcrPaths, value: string) => {
    setCustomPaths((paths) => ({ ...paths, [key]: value }));
  };

  const chooseCustomPath = async (
    key: keyof CustomOcrPaths,
    title: string,
    extensions?: string[],
  ) => {
    try {
      const path = await pickFile(title, extensions);
      if (!path) return;
      const next = { ...customPaths, [key]: path };
      setCustomPaths(next);
      await saveCustomPaths(next);
    } catch (error) {
      useStore.setState({
        statusMsg: `${t(locale, "settings.customModelSaveFailed")}: ${String(error)}`,
      });
    }
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

  const updateLayoutTuning = (key: string, value: number) => {
    setInferenceTuning({
      ...inferenceTuning,
      layout: { ...inferenceTuning.layout, [key]: value },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t(locale, "settings.title")}</DialogTitle>
          <DialogDescription>{t(locale, "settings.description")}</DialogDescription>
        </DialogHeader>

        <div ref={scrollRef} className="max-h-[65vh] overflow-y-auto pr-1">
          <div
            ref={(element) => {
              sectionRefs.current.general = element;
            }}
          >
            <SettingsGroup title={t(locale, "settings.appearanceTitle")}>
              <SettingRow title={t(locale, "settings.language")}>
                <div className="flex rounded-md border bg-background p-0.5" role="radiogroup">
                  {LOCALE_OPTIONS.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      size="sm"
                      variant={locale === option.key ? "default" : "ghost"}
                      className="h-7 rounded-sm"
                      role="radio"
                      aria-checked={locale === option.key}
                      onClick={() => setLocale(option.key as Locale)}
                    >
                      {t(locale, option.labelKey)}
                    </Button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow title={t(locale, "settings.theme")}>
                <div className="flex rounded-md border bg-background p-0.5" role="radiogroup">
                  {THEME_OPTIONS.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      size="sm"
                      variant={theme === option.key ? "default" : "ghost"}
                      className="h-7 rounded-sm"
                      role="radio"
                      aria-checked={theme === option.key}
                      onClick={() => setTheme(option.key as Theme)}
                    >
                      {t(locale, option.labelKey)}
                    </Button>
                  ))}
                </div>
              </SettingRow>
            </SettingsGroup>
          </div>

          <div
            ref={(element) => {
              sectionRefs.current.annotation = element;
            }}
          >
            <SettingsGroup title={t(locale, "settings.annotationTitle")}>
              <SettingRow
                title={t(locale, "settings.minBoxSize")}
                description={t(locale, "settings.minBoxSizeDesc")}
              >
                <Input
                  className="w-24"
                  type="number"
                  min={1}
                  max={128}
                  step={1}
                  value={minBoxSize}
                  aria-label={t(locale, "settings.minBoxSize")}
                  onChange={(event) => setMinBoxSize(event.target.valueAsNumber)}
                />
              </SettingRow>
            </SettingsGroup>
          </div>

          <div
            ref={(element) => {
              sectionRefs.current.models = element;
            }}
          >
            <SettingsGroup title={t(locale, "settings.inferenceTitle")}>
              <SettingRow title={t(locale, "settings.device")}>
                <div className="flex rounded-md border bg-background p-0.5" role="radiogroup">
                  {deviceOptions.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      size="sm"
                      variant={device === option.key ? "default" : "ghost"}
                      className="h-7 rounded-sm"
                      role="radio"
                      aria-checked={device === option.key}
                      onClick={() => setDevice(option.key as Device)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </SettingRow>

              <div className="grid gap-3 pt-1">
                <div className="text-sm font-medium">
                  {t(locale, "settings.textParamsTitle")}
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
                    onChange={(value) =>
                      updateTextRecognitionTuning("score_threshold", value)
                    }
                  />
                </div>
              </div>

              <div className="grid gap-3 border-t pt-4">
                <div className="text-sm font-medium">
                  {t(locale, "settings.layoutParamsTitle")}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ThresholdNumber
                    label={t(locale, "settings.layoutScoreThreshold")}
                    value={inferenceTuning.layout.score_threshold ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateLayoutTuning("score_threshold", value)}
                  />
                  <ThresholdNumber
                    label={t(locale, "settings.layoutNmsThreshold")}
                    value={inferenceTuning.layout.nms_threshold ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => updateLayoutTuning("nms_threshold", value)}
                  />
                  <ThresholdNumber
                    label={t(locale, "settings.layoutMaxElements")}
                    value={inferenceTuning.layout.max_elements ?? 100}
                    min={1}
                    max={1000}
                    step={1}
                    onChange={(value) => updateLayoutTuning("max_elements", value)}
                  />
                </div>
              </div>
            </SettingsGroup>

            <SettingsGroup
              title={t(locale, "settings.customTitle")}
              description={t(locale, "settings.customDesc")}
            >
              <div className="grid gap-3">
                {customPathsLoading && (
                  <div className="text-xs text-muted-foreground">
                    {t(locale, "settings.loading")}
                  </div>
                )}
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
                      disabled={customPathsLoading}
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
                      disabled={customPathsLoading}
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
                      disabled={customPathsLoading}
                />
              </div>
            </SettingsGroup>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b py-5">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm text-foreground/90">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function PathInput({
  label,
  value,
  browseLabel,
  onChange,
  onCommit,
  onBrowse,
  disabled,
}: {
  label: string;
  value: string;
  browseLabel: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onBrowse: () => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      <span>{label}</span>
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1 font-mono text-xs"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label={browseLabel}
          title={browseLabel}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
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
