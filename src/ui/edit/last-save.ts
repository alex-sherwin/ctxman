// Browser-safe (sessionStorage): carry "Saved" across the page reload that follows a save. The editor calls
// `rememberSave(key, message)` just before `location.reload()` / `assign()`; the reloaded page calls
// `takeSave(key)` once on mount and shows the message. Read-once, so a second reload shows nothing.
// Every storage access is wrapped (private windows, blocked storage).

const PREFIX = 'ctxman:saved:';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberSave(key: string, message: string): void {
  try {
    storage()?.setItem(PREFIX + key, message);
  } catch {
    // the status is a convenience only
  }
}

/** The remembered message, removed from storage; null when there is none. */
export function takeSave(key: string): string | null {
  try {
    const store = storage();
    const message = store?.getItem(PREFIX + key) ?? null;
    if (message !== null) store?.removeItem(PREFIX + key);
    return message;
  } catch {
    return null;
  }
}
