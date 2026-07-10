export function isTextInputTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
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
