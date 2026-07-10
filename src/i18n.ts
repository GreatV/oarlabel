import enUS from "@/locales/en-US.json";
import zhCN from "@/locales/zh-CN.json";

export type Locale = "zh-CN" | "en-US";

const messages = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;

export type MessageKey = keyof typeof zhCN;

export const LOCALE_OPTIONS: { key: Locale; labelKey: MessageKey }[] = [
  { key: "zh-CN", labelKey: "locale.zh-CN" },
  { key: "en-US", labelKey: "locale.en-US" },
];

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}

export function tt(
  locale: Locale,
  key: MessageKey,
  params: Record<string, string | number>,
): string {
  let value = t(locale, key);
  for (const [name, replacement] of Object.entries(params)) {
    value = value.split(`{${name}}`).join(String(replacement));
  }
  return value;
}

export function modeLabel(locale: Locale, mode: string): string {
  return t(locale, `mode.${mode}` as MessageKey);
}

export function statusLabel(locale: Locale, status: string): string {
  return t(locale, `status.${status}` as MessageKey);
}
