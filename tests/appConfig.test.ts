import { describe, expect, it } from "vitest";
import { layoutLabelOptions } from "@/lib/layoutLabels";
import { LINKS } from "@/lib/links";
import { virtualRange } from "@/lib/virtualList";
import {
  movePanelInOrder,
  normalizePanelDocks,
  normalizePanelOrder,
  normalizePanelSplitRatios,
  panelsForSide,
} from "@/lib/panelDock";

describe("application links", () => {
  it("keeps every help destination inside the oarlabel repository", () => {
    expect(Object.values(LINKS).every((link) => link.startsWith(LINKS.repo))).toBe(true);
    expect(LINKS.repo).toBe("https://github.com/GreatV/oarlabel");
  });
});

describe("panel docking preferences", () => {
  it("defaults to split sides and accepts moving both panels together", () => {
    expect(normalizePanelDocks(null)).toEqual({ fileList: "left", results: "right" });
    expect(normalizePanelDocks({ fileList: "right", results: "right" })).toEqual({
      fileList: "right",
      results: "right",
    });
  });

  it("rejects invalid persisted sides", () => {
    expect(normalizePanelDocks({ fileList: "top", results: 42 })).toEqual({
      fileList: "left",
      results: "right",
    });
  });

  it("stacks visible panels in a stable top-to-bottom order on the same side", () => {
    const docks = normalizePanelDocks({ fileList: "left", results: "left" });
    expect(panelsForSide(docks, { fileList: true, results: true }, "left")).toEqual([
      "fileList",
      "results",
    ]);
    expect(panelsForSide(docks, { fileList: false, results: true }, "left")).toEqual([
      "results",
    ]);
  });

  it("persists either panel above the other and rejects invalid orders", () => {
    const reversed = movePanelInOrder(["fileList", "results"], "results", "top");
    expect(reversed).toEqual(["results", "fileList"]);
    expect(
      panelsForSide(
        { fileList: "right", results: "right" },
        { fileList: true, results: true },
        "right",
        reversed,
      ),
    ).toEqual(["results", "fileList"]);
    expect(normalizePanelOrder(["results", "results"])).toEqual([
      "fileList",
      "results",
    ]);
  });

  it("defaults stacked panels to equal heights and clamps persisted ratios", () => {
    expect(normalizePanelSplitRatios(null)).toEqual({ left: 0.5, right: 0.5 });
    expect(normalizePanelSplitRatios({ left: 0.7, right: 2 })).toEqual({
      left: 0.7,
      right: 0.85,
    });
  });
});

describe("layout label choices", () => {
  it("offers detector labels and preserves an unknown model label", () => {
    expect(layoutLabelOptions("formula")).toContain("formula_number");
    expect(layoutLabelOptions("custom_detector_label")[0]).toBe("custom_detector_label");
  });
});

describe("file list virtualization", () => {
  it("renders only the visible window for a 20,000-file workspace", () => {
    const range = virtualRange(20_000, 45, 450_000, 600, 8);
    expect(range.end - range.start).toBeLessThan(40);
    expect(range.start).toBeGreaterThan(9_000);
  });
});
