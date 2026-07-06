// Small platform helpers. The keyboard handler already accepts both Ctrl and
// meta (useShortcuts), so these only affect how shortcut strings are *shown*.

/** True on macOS / iOS (used for traffic-light padding, shortcut symbols). */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/** The platform-appropriate modifier label, e.g. "⌘" on macOS, "Ctrl" elsewhere. */
export function modKey(): string {
  return isMac ? "⌘" : "Ctrl";
}

/**
 * Render a canonical shortcut string for the current platform. Canonical input
 * uses the "Ctrl" prefix (e.g. "Ctrl+S", "Ctrl+Shift+Z", "Ctrl+="); on macOS the
 * leading "Ctrl" is replaced with "⌘". Non-prefixed shortcuts ("Del", "F11",
 * "Left / Right") pass through unchanged.
 */
export function shortcut(canonical: string): string {
  if (!isMac) return canonical;
  if (canonical.startsWith("Ctrl+")) return `⌘${canonical.slice(4)}`;
  return canonical;
}
