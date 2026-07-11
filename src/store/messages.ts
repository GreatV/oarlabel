import { tt, type Locale } from "@/i18n";

export function appendSkipped(locale: Locale, message: string, skipped: number): string {
  if (skipped <= 0) return message;
  const separator = locale === "zh-CN" ? "，" : ", ";
  return `${message}${separator}${tt(locale, "message.regionsSkipped", { skipped })}`;
}
