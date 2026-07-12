export const NATIVE_RECENT_LIMIT = 8;

export interface NativeMenuAvailability {
  hasImage: boolean;
  hasImages: boolean;
  hasSelection: boolean;
  busy: boolean;
  batchRunning: boolean;
  currentLocked: boolean;
  nextLocked: boolean;
  hasUndo: boolean;
  hasRedo: boolean;
  hasClipboard: boolean;
  recentCount: number;
}

export interface MenuItemStatePayload {
  id: string;
  value: boolean;
}

export function nativeMenuEnabledState({
  hasImage,
  hasImages,
  hasSelection,
  busy,
  batchRunning,
  currentLocked,
  nextLocked,
  hasUndo,
  hasRedo,
  hasClipboard,
  recentCount,
}: NativeMenuAvailability): Record<string, boolean> {
  const filesystemIdle = !busy && !batchRunning;
  const editorIdle = !currentLocked;
  const enabled: Record<string, boolean> = {
    "oar:open-folder": filesystemIdle,
    "oar:import-images": filesystemIdle,
    "oar:save": hasImage && editorIdle,
    "oar:save-and-next": hasImage && editorIdle && !nextLocked,
    "oar:export": hasImages && filesystemIdle,
    "oar:undo": hasUndo && editorIdle,
    "oar:redo": hasRedo && editorIdle,
    "oar:copy": hasSelection,
    "oar:paste": hasImage && hasClipboard && editorIdle,
    "oar:select-all": hasImage,
    "oar:clear-sel": hasSelection,
    "oar:delete": hasSelection && editorIdle,
    "oar:zoom-in": hasImage,
    "oar:zoom-out": hasImage,
    "oar:actual": hasImage,
    "oar:fit-window": hasImage,
    "oar:fit-width": hasImage,
  };
  for (let index = 0; index < NATIVE_RECENT_LIMIT; index += 1) {
    enabled[`oar:recent:${index}`] = index < recentCount && filesystemIdle;
  }
  return enabled;
}

export function changedMenuStatePayloads(
  previous: Readonly<Record<string, boolean>>,
  next: Readonly<Record<string, boolean>>,
  force = false,
): MenuItemStatePayload[] {
  return Object.entries(next)
    .filter(([id, value]) => force || previous[id] !== value)
    .map(([id, value]) => ({ id, value }));
}
