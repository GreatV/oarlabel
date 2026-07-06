// Distinct annotation colors backed by CSS variables so themes can tune them.
//
// Konva draws to a <canvas>, whose fillStyle parser does NOT understand CSS
// custom properties (var(--…)). Passing "hsl(var(--annotation-1))" to Konva
// therefore resolves to an invalid color and the canvas silently falls back to
// black — which is why every box rendered black regardless of palette. To make
// the palette actually work we resolve the CSS variables to concrete values at
// runtime via getComputedStyle, and re-resolve whenever the theme (.dark) flips.

import { useEffect, useState } from "react";

const KEYS = [
  "--annotation-1",
  "--annotation-2",
  "--annotation-3",
  "--annotation-4",
  "--annotation-5",
  "--annotation-6",
  "--annotation-7",
  "--annotation-8",
  "--annotation-9",
  "--annotation-10",
] as const;

type RGB = { r: number; g: number; b: number };

let cachedPalette: string[] | null = null;
let cachedTheme: string | null = null;

function resolveHsl(raw: string): RGB {
  // Values come from `--annotation-*` in index.css as "H S% L%".
  const m = raw.trim().match(
    /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/,
  );
  if (!m) return { r: 0, g: 0, b: 0 };
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function readPalette(): string[] {
  const root = document.documentElement;
  const theme = root.classList.contains("dark") ? "dark" : "light";
  if (cachedPalette && cachedTheme === theme) return cachedPalette;
  const style = getComputedStyle(root);
  const palette = KEYS.map((k) => {
    const rgb = resolveHsl(style.getPropertyValue(k));
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  });
  cachedPalette = palette;
  cachedTheme = theme;
  return palette;
}

export function palette(): string[] {
  return readPalette();
}

export function colorFor(index: number): string {
  const p = readPalette();
  return p[index % p.length];
}

/** Parse an rgb()/rgba() string into {r,g,b} for building alpha variants.
 *  Inputs always come from readPalette(), which formats them as "rgb(r, g, b)". */
function toRGB(color: string): RGB {
  const rgb = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)!;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

/** rgba(...) with the given alpha — safe to pass directly to Konva. */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = toRGB(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * React hook returning a palette that re-resolves when the light/dark theme
 * changes (the `.dark` class on <html>). Components that derive annotation
 * colors at render time should use this so they repaint on theme switch.
 */
export function usePalette(): string[] {
  const [p, setP] = useState<string[]>(() => readPalette());
  useEffect(() => {
    setP(readPalette());
    const root = document.documentElement;
    const mo = new MutationObserver(() => {
      cachedPalette = null;
      setP(readPalette());
    });
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return p;
}
