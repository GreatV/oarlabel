import type { MessageKey } from "@/i18n";

export interface Shortcut {
  keys: string;
  descKey: MessageKey;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl+S", descKey: "shortcuts.save" },
  { keys: "Ctrl+Enter", descKey: "shortcuts.saveAndNext" },
  { keys: "Ctrl+Z", descKey: "shortcuts.undo" },
  { keys: "Ctrl+Shift+Z", descKey: "shortcuts.redo" },
  { keys: "Ctrl+Y", descKey: "shortcuts.redo" },
  { keys: "Ctrl+C", descKey: "shortcuts.copy" },
  { keys: "Ctrl+V", descKey: "menu.edit.paste" },
  { keys: "Ctrl+A", descKey: "shortcuts.selectAll" },
  { keys: "Backspace / Delete", descKey: "shortcuts.deleteOrUndoPoint" },
  { keys: "Esc", descKey: "shortcuts.cancel" },
  { keys: "A / ←", descKey: "shortcuts.prev" },
  { keys: "D / →", descKey: "shortcuts.next" },
  { keys: "Ctrl+=", descKey: "shortcuts.zoomIn" },
  { keys: "Ctrl+-", descKey: "shortcuts.zoomOut" },
  { keys: "Ctrl+0", descKey: "shortcuts.actual" },
  { keys: "F11", descKey: "shortcuts.fullscreen" },
  { keys: "R", descKey: "shortcuts.rect" },
  { keys: "P", descKey: "shortcuts.polygon" },
];
