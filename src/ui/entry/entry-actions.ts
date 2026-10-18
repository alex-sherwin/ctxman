// Browser-only: the contract between the server-rendered `[data-entry-action]` buttons of an entry page and the
// EntryTools island (ROUND3_SPEC §E.1, §E.3). The pages render the buttons `disabled`; the island enables them on
// mount and disables them (and `select[data-state-select]`) again while the doc editor is open, so a PATCH can
// never invalidate an open draft's base. A control the island locked is marked with `data-edit-locked` (its value
// is the title it had), so unlocking never enables something another script (the state select's own PATCH)
// disabled for its own reasons.
import type { ActionTrigger } from './entry-helpers.ts';

export const LOCK_TITLE = 'Leave the editor first';
const LOCK_ATTR = 'data-edit-locked';
const SELECTOR = '[data-entry-action], select[data-state-select]';

type Control = HTMLButtonElement | HTMLSelectElement;

const isAction = (el: Element): boolean => el.hasAttribute('data-entry-action');

function lock(el: Control): void {
  if (el.hasAttribute(LOCK_ATTR)) return;
  // a state select that its own request disabled stays as it is
  if (!isAction(el) && el.disabled) return;
  el.setAttribute(LOCK_ATTR, el.getAttribute('title') ?? '');
  el.disabled = true;
  el.setAttribute('title', LOCK_TITLE);
}

function unlock(el: Control): void {
  if (el.hasAttribute(LOCK_ATTR)) {
    const original = el.getAttribute(LOCK_ATTR) ?? '';
    el.removeAttribute(LOCK_ATTR);
    if (original === '') el.removeAttribute('title');
    else el.setAttribute('title', original);
    el.disabled = false;
  } else if (isAction(el)) {
    el.disabled = false; // first mount: the SSR buttons are rendered disabled
  }
}

/** `locked` true = the doc editor is open: disable every action button and state select, with a reason. */
export function syncActions(locked: boolean, root: ParentNode = document): void {
  for (const el of root.querySelectorAll<Control>(SELECTOR)) {
    if (locked) lock(el);
    else unlock(el);
  }
}

/**
 * What a clicked button says: `data-entry-action` plus `data-key` / `data-rel` (also read from the row it sits
 * in), `data-path` and the title (`data-title`, else the title of that key in `titles`, else the row's link text).
 */
export function readTrigger(el: HTMLElement, titles: ReadonlyMap<string, string>): ActionTrigger {
  const row = el.closest<HTMLElement>('[data-key]');
  const key = el.dataset.key ?? row?.dataset.key;
  return {
    action: el.dataset.entryAction,
    key,
    rel: el.dataset.rel ?? row?.dataset.rel,
    path: el.dataset.path,
    title:
      el.dataset.title ??
      (key === undefined ? undefined : titles.get(key)) ??
      row?.querySelector('.cx-rowlink__main')?.textContent ??
      undefined,
  };
}
