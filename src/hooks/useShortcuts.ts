import { useEffect } from "react";
import { win } from "@/lib/tauri";
import {
  imageNavigationDirection,
  isRedoShortcut,
  shouldIgnoreGlobalShortcut,
} from "@/lib/keyboard";
import { useStore } from "@/store";

export function useShortcuts(openSettings?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(e.target)) return;
      const s = useStore.getState();
      const meta = e.ctrlKey || e.metaKey;
      const navigation = imageNavigationDirection(e);

      if (meta && e.key === "," && openSettings) {
        e.preventDefault();
        openSettings();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        s.save();
      } else if (meta && e.key === "Enter") {
        e.preventDefault();
        void s.saveAndNext();
      } else if (meta && isRedoShortcut(e)) {
        e.preventDefault();
        s.redo();
      } else if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      } else if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.selectAll();
      } else if (meta && e.key.toLowerCase() === "c") {
        e.preventDefault();
        s.copySelection();
      } else if (meta && e.key.toLowerCase() === "v") {
        e.preventDefault();
        s.paste();
      } else if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        s.setZoom(s.zoom * 1.2);
      } else if (meta && e.key === "-") {
        e.preventDefault();
        s.setZoom(s.zoom / 1.2);
      } else if (meta && e.key === "0") {
        e.preventDefault();
        s.requestFit("actual");
      } else if (e.key === "F11") {
        e.preventDefault();
        win.toggleFullscreen();
      } else if (navigation) {
        e.preventDefault();
        if (navigation === "next") s.next();
        else s.prev();
      } else if (!meta && (e.key === "r" || e.key === "R")) {
        s.setTool(s.tool === "rect" ? "select" : "rect");
      } else if (!meta && (e.key === "p" || e.key === "P")) {
        s.setTool(s.tool === "polygon" ? "select" : "polygon");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings]);
}
