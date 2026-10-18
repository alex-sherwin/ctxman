// Browser-only store for the status line of the EntryTools island (`<p role="status" data-testid="entry-status">`):
// the message of the last write, shown for STATUS_VISIBLE_MS. `initEntryStatus` picks up the message the
// previous page parked before it reloaded (`after-write.ts`). A store, not component state, so the island sets
// it from event handlers and mount code without a setState-in-effect.
import { atom } from 'nanostores';
import { takeSave } from '../edit/last-save.ts';

export const STATUS_VISIBLE_MS = 6000;

export const $entryStatus = atom<string>('');

let timer: ReturnType<typeof setTimeout> | undefined;

export function showEntryStatus(message: string): void {
  if (timer !== undefined) clearTimeout(timer);
  $entryStatus.set(message);
  timer = setTimeout(() => {
    timer = undefined;
    $entryStatus.set('');
  }, STATUS_VISIBLE_MS);
}

/** Show (once) the message the page before the reload left under `key`. */
export function initEntryStatus(key: string): void {
  const saved = takeSave(key);
  if (saved !== null) showEntryStatus(saved);
}
