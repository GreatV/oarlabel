import { useEffect } from "react";
import { useStore } from "@/store";
import type { Theme } from "@/types";

/** Resolve a theme to a concrete light/dark value, expanding `system` via the
 *  OS `prefers-color-scheme` media query. */
function resolvedDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

/** Apply the `.dark` class on `<html>` to match the active theme. Tailwind's
 *  `darkMode: ["class"]` and the CSS variables in index.css both key off this
 *  class, and `palette.ts`'s MutationObserver repaints the Konva canvas when it
 *  flips — so a single class toggle restyles the whole app.
 *
 *  When the theme is `system`, we also subscribe to `prefers-color-scheme`
 *  changes so following the OS is live. */
export function useTheme(): void {
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = resolvedDark(theme);
      root.classList.toggle("dark", dark);
    };
    apply();

    if (theme !== "system") return;
    // Only `system` needs to react to OS changes at runtime.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);
}
