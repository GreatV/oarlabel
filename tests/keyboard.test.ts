import { describe, expect, it } from "vitest";
import { shouldIgnoreGlobalShortcut } from "@/lib/keyboard";

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
  });
});
