import { describe, expect, it } from "vitest";
import { LOCALE_OPTIONS, t, tt } from "@/i18n";
import { SHORTCUTS } from "@/lib/shortcuts";

describe("i18n", () => {
  it("keeps locale option labels readable", () => {
    expect(LOCALE_OPTIONS.map((option) => t("en-US", option.labelKey))).toEqual([
      "简体中文",
      "English",
    ]);
    expect(LOCALE_OPTIONS.map((option) => t("zh-CN", option.labelKey))).toEqual([
      "简体中文",
      "English",
    ]);
  });

  it("formats parameterized messages", () => {
    expect(tt("en-US", "message.loadedImages", { count: 3 })).toBe("Loaded 3 images");
    expect(tt("zh-CN", "message.loadedImages", { count: 3 })).toContain("3");
  });

  it("contains localized confirmation copy", () => {
    expect(t("en-US", "confirm.discardChanges.title")).toBe("Unsaved changes");
    expect(t("zh-CN", "confirm.replaceAnnotations.title")).toBe("替换标注");
  });

  it("distinguishes current-image saves from other unsaved images", () => {
    expect(t("en-US", "message.currentImageSaved")).toBe("Current image saved");
    expect(t("zh-CN", "statusbar.otherImagesUnsaved")).toBe("其他图片未保存");
  });

  it("documents canvas-only shortcut behavior", () => {
    expect(SHORTCUTS).toEqual(
      expect.arrayContaining([
        { keys: "Ctrl+Y", descKey: "shortcuts.redo" },
        { keys: "Backspace / Delete", descKey: "shortcuts.deleteOrUndoPoint" },
        { keys: "Enter", descKey: "shortcuts.finishPolygon" },
        { keys: "Space", descKey: "shortcuts.panCanvas" },
      ]),
    );
    expect(t("zh-CN", "shortcuts.finishPolygon")).toBe("完成多边形绘制");
    expect(t("en-US", "shortcuts.panCanvas")).toBe("Hold to pan canvas");
  });
});
