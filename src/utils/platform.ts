const _isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function isMac(): boolean {
  return _isMac;
}

export function modKey(): string {
  return _isMac ? '⌘' : 'Ctrl';
}

export function formatShortcut(key: string, shift = false): string {
  if (_isMac) {
    return shift ? `⇧⌘${key}` : `⌘${key}`;
  }
  return shift ? `Shift+Ctrl+${key}` : `Ctrl+${key}`;
}

export function isModKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}
