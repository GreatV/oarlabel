import { describe, expect, it } from "vitest";
import {
  imageNavigationDirection,
  isInteractiveControlTarget,
  isRedoShortcut,
  shouldIgnoreGlobalShortcut,
} from "@/lib/keyboard";

describe("global shortcut guard", () => {
  it("blocks workspace shortcuts while a dialog is mounted", () => {
    const button = { tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget;
    const root = {
      querySelector: () => ({ role: "dialog" }),
    } as unknown as Pick<Document, "querySelector">;

    expect(shouldIgnoreGlobalShortcut(button, root)).toBe(true);
  });

  it("allows shortcuts from a button when no dialog is mounted", () => {
    const button = { tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget;
    const root = {
      querySelector: () => null,
    } as unknown as Pick<Document, "querySelector">;

    expect(shouldIgnoreGlobalShortcut(button, root)).toBe(false);
    expect(isInteractiveControlTarget(button)).toBe(true);
  });
});

describe("redo shortcuts", () => {
  it("supports Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z key shapes", () => {
    expect(isRedoShortcut({ key: "y", shiftKey: false })).toBe(true);
    expect(isRedoShortcut({ key: "Z", shiftKey: true })).toBe(true);
    expect(isRedoShortcut({ key: "z", shiftKey: false })).toBe(false);
  });
});

describe("image navigation shortcuts", () => {
  const keyEvent = (key: string, modifiers = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  });

  it.each(["a", "A", "ArrowLeft"])("maps %s to the previous image", (key) => {
    expect(imageNavigationDirection(keyEvent(key))).toBe("prev");
  });

  it.each(["d", "D", "ArrowRight"])("maps %s to the next image", (key) => {
    expect(imageNavigationDirection(keyEvent(key))).toBe("next");
  });

  it("does not intercept modified keys", () => {
    expect(imageNavigationDirection(keyEvent("a", { ctrlKey: true }))).toBeNull();
    expect(imageNavigationDirection(keyEvent("ArrowRight", { altKey: true }))).toBeNull();
  });
});
