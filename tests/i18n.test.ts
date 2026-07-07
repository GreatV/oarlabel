import { describe, expect, it } from "vitest";
import { LOCALE_OPTIONS, t, tt } from "@/i18n";

describe("i18n", () => {
  it("keeps locale option labels readable", () => {
    expect(LOCALE_OPTIONS.map((option) => option.label)).toEqual(["简体中文", "English"]);
  });

  it("formats parameterized messages", () => {
    expect(tt("en-US", "message.loadedImages", { count: 3 })).toBe("Loaded 3 images");
    expect(tt("zh-CN", "message.loadedImages", { count: 3 })).toContain("3");
  });

  it("contains localized confirmation copy", () => {
    expect(t("en-US", "confirm.discardChanges.title")).toBe("Unsaved changes");
    expect(t("zh-CN", "confirm.replaceAnnotations.title")).toBe("替换标注");
  });
});
