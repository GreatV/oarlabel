export type PanelId = "fileList" | "results";
export type PanelSide = "left" | "right";
export type PanelStackPosition = "top" | "bottom";

export type PanelDocks = Record<PanelId, PanelSide>;
export type PanelSplitRatios = Record<PanelSide, number>;

export const PANEL_ORDER: PanelId[] = ["fileList", "results"];

export const PANEL_DOCK_STORAGE_KEY = "oarlabel.panelDocks";
export const PANEL_ORDER_STORAGE_KEY = "oarlabel.panelOrder";
export const PANEL_SPLIT_STORAGE_KEY = "oarlabel.panelSplitRatios";

export const DEFAULT_PANEL_DOCKS: PanelDocks = {
  fileList: "left",
  results: "right",
};

export const DEFAULT_PANEL_SPLIT_RATIOS: PanelSplitRatios = {
  left: 0.5,
  right: 0.5,
};

export function normalizePanelDocks(value: unknown): PanelDocks {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<PanelId, unknown>>)
      : {};
  return {
    fileList: source.fileList === "right" ? "right" : "left",
    results: source.results === "left" ? "left" : "right",
  };
}

export function panelsForSide(
  docks: PanelDocks,
  visible: Partial<Record<PanelId, boolean>>,
  side: PanelSide,
  order: PanelId[] = PANEL_ORDER,
): PanelId[] {
  return order.filter((panel) => visible[panel] && docks[panel] === side);
}

export function normalizePanelOrder(value: unknown): PanelId[] {
  if (!Array.isArray(value)) return [...PANEL_ORDER];
  const order = value.filter(
    (panel, index): panel is PanelId =>
      (panel === "fileList" || panel === "results") && value.indexOf(panel) === index,
  );
  return order.length === PANEL_ORDER.length ? order : [...PANEL_ORDER];
}

export function movePanelInOrder(
  order: PanelId[],
  panel: PanelId,
  position: PanelStackPosition,
): PanelId[] {
  const others = normalizePanelOrder(order).filter((item) => item !== panel);
  return position === "top" ? [panel, ...others] : [...others, panel];
}

export function normalizePanelSplitRatios(value: unknown): PanelSplitRatios {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<PanelSide, unknown>>)
      : {};
  const normalize = (ratio: unknown): number =>
    typeof ratio === "number" && Number.isFinite(ratio)
      ? Math.min(0.85, Math.max(0.15, ratio))
      : 0.5;
  return {
    left: normalize(source.left),
    right: normalize(source.right),
  };
}
