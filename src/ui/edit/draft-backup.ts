// Browser-safe (sessionStorage): survive a dev reload caused by ANOTHER file changing while an editor is
// open (`astro dev` reloads the page ~0.7 s after any glob-watched change under data/). An editor saves its
// unsaved text on every change, restores it on mount when the base still matches, and clears it on
// save / cancel. Every storage access is wrapped: private windows and blocked storage just mean "no backup".

const PREFIX = 'ctxman:draft:';

/** The unsaved `text`, and `base` = the saved text (or `lastModified`) it was started from. */
export interface Draft {
  text: string;
  base: string;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, value: Draft): void {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // quota / blocked: the draft is a convenience only
  }
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Draft).text === 'string' &&
      typeof (parsed as Draft).base === 'string'
    ) {
      return { text: (parsed as Draft).text, base: (parsed as Draft).base };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // nothing to clear
  }
}
