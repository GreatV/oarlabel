import { describe, expect, it } from "vitest";
import {
  changedMenuStatePayloads,
  nativeMenuEnabledState,
} from "@/lib/nativeMenu";

describe("native menu state", () => {
  it("disables mutating and filesystem actions while busy", () => {
    const state = nativeMenuEnabledState({
      hasImage: true,
      hasImages: true,
      hasSelection: true,
      busy: true,
      batchRunning: false,
      currentLocked: true,
      nextLocked: false,
      hasUndo: true,
      hasRedo: true,
      hasClipboard: true,
      recentCount: 2,
    });

    expect(state["oar:save"]).toBe(false);
    expect(state["oar:delete"]).toBe(false);
    expect(state["oar:recent:0"]).toBe(false);
    expect(state["oar:copy"]).toBe(true);
    expect(state["oar:zoom-in"]).toBe(true);
  });

  it("enables only populated recent-workspace entries", () => {
    const state = nativeMenuEnabledState({
      hasImage: false,
      hasImages: false,
      hasSelection: false,
      busy: false,
      batchRunning: false,
      currentLocked: false,
      nextLocked: true,
      hasUndo: false,
      hasRedo: false,
      hasClipboard: false,
      recentCount: 2,
    });

    expect(state["oar:recent:0"]).toBe(true);
    expect(state["oar:recent:1"]).toBe(true);
    expect(state["oar:recent:2"]).toBe(false);
  });

  it("keeps completed images editable while a batch is still running", () => {
    const state = nativeMenuEnabledState({
      hasImage: true,
      hasImages: true,
      hasSelection: true,
      busy: false,
      batchRunning: true,
      currentLocked: false,
      nextLocked: true,
      hasUndo: true,
      hasRedo: false,
      hasClipboard: true,
      recentCount: 1,
    });

    expect(state["oar:save"]).toBe(true);
    expect(state["oar:undo"]).toBe(true);
    expect(state["oar:paste"]).toBe(true);
    expect(state["oar:save-and-next"]).toBe(false);
    expect(state["oar:open-folder"]).toBe(false);
    expect(state["oar:export"]).toBe(false);
  });

  it("emits structured payloads only for changed values", () => {
    expect(
      changedMenuStatePayloads(
        { "oar:save": false, "oar:undo": false },
        { "oar:save": true, "oar:undo": false },
      ),
    ).toEqual([{ id: "oar:save", value: true }]);
  });
});
