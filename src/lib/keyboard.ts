export function isTextInputTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function isInteractiveControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "BUTTON" ||
    tag === "A" ||
    tag === "SELECT" ||
    tag === "SUMMARY" ||
    el.getAttribute?.("role") === "button"
  );
}

/** Global canvas/workspace shortcuts must not leak through modal dialogs.
 * Dialog components are portalled outside the app subtree, so checking the
 * active event target alone is insufficient when focus is on a dialog button. */
export function shouldIgnoreGlobalShortcut(
  target: EventTarget | null,
  root: Pick<Document, "querySelector"> = document,
): boolean {
  return isTextInputTarget(target) || root.querySelector('[role="dialog"]') !== null;
}

export function isRedoShortcut(event: Pick<KeyboardEvent, "key" | "shiftKey">): boolean {
  const key = event.key.toLowerCase();
  return key === "y" || (event.shiftKey && key === "z");
}

export type ImageNavigationDirection = "prev" | "next";

export function imageNavigationDirection(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): ImageNavigationDirection | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const key = event.key.toLowerCase();
  if (key === "a" || key === "arrowleft") return "prev";
  if (key === "d" || key === "arrowright") return "next";
  return null;
}
