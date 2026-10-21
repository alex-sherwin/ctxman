// Browser-only: a one-shot message for the next load of a list page. A row action that writes (Log time) stores
// it right before `location.reload()`; the ListTable reads it when it mounts, shows it in its bar and clears it.
// Storage blocked or empty = no message (a nicety only).
const FLASH_KEY = 'ctxman:list-flash';

export function setListFlash(text: string): void {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ path: location.pathname, text }));
  } catch {
    // storage blocked: no message after the reload
  }
}

/** The message stored for this list page; null when there is none. Reading leaves it stored (see clearListFlash). */
export function readListFlash(): string | null {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const { path, text } = value as { path?: unknown; text?: unknown };
    return path === location.pathname && typeof text === 'string' && text !== '' ? text : null;
  } catch {
    return null;
  }
}

export function clearListFlash(): void {
  try {
    sessionStorage.removeItem(FLASH_KEY);
  } catch {
    // storage blocked: nothing was stored
  }
}
