// Browser-safe (localStorage): unsaved editor text survives a reload, a closed tab and a dev reload caused by
// a code change (`astro dev` reloads the page when a source file changes).
// An editor saves its unsaved text on every change, offers it again on the next load, and clears it on
// save / revert / discard. Because the native `beforeunload` prompt is gone (ROUND3_SPEC §G), this is what keeps
// work from being lost: it lives 14 days (a draft older than that is dropped on the next read).
// `base` = the saved text (or `lastModified`) the draft was started from; the CONSUMER compares it with the
// disk and shows a warning when the file changed meanwhile (the draft is still restored). Every storage access
// is wrapped: private windows and blocked storage just mean "no backup".

const PREFIX = 'ctxman:draft:';

/** A draft is dropped (removed, reported as absent) when it is older than this. */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** The unsaved `text`, and `base` = the saved text (or `lastModified`) it was started from. */
export interface Draft {
  text: string;
  base: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Parse a stored value. Null for anything that is not a draft; `expired` when `savedAt` is a number older than
 * the TTL (a value without a numeric `savedAt`, e.g. from before the TTL existed, counts as fresh).
 */
function parse(raw: string): { draft: Draft; expired: boolean } | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Partial<Record<keyof Draft | 'savedAt', unknown>>;
  if (typeof value.text !== 'string' || typeof value.base !== 'string') return null;
  const expired = typeof value.savedAt === 'number' && Date.now() - value.savedAt > DRAFT_TTL_MS;
  return { draft: { text: value.text, base: value.base }, expired };
}

export function saveDraft(key: string, value: Draft): void {
  try {
    storage()?.setItem(
      PREFIX + key,
      JSON.stringify({ text: value.text, base: value.base, savedAt: Date.now() }),
    );
  } catch {
    // quota / blocked: the draft is a convenience only
  }
}

/** The stored draft, or null when there is none, it is unreadable, or it is older than 14 days (then removed). */
export function loadDraft(key: string): Draft | null {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return null;
    const found = parse(raw);
    if (found === null) return null;
    if (found.expired) {
      clearDraft(key);
      return null;
    }
    return found.draft;
  } catch {
    return null;
  }
}

/** True iff `loadDraft(key)` would return a draft (an expired one is removed on the way). */
export function hasDraft(key: string): boolean {
  return loadDraft(key) !== null;
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // nothing to clear
  }
}
