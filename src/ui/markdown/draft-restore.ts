// PURE (browser-safe): what to do with a stored draft once the file it was started from has been loaded
// (ROUND3_SPEC §G). Shared by the DocEditor store and the MarkdownModal popup (which also keys its draft here).
//
// A draft is restored whenever its text differs from the file on disk. When the file ALSO changed since the draft
// was started (`base` is the `lastModified` it was started from), the draft is restored with `stale: true` so the
// editor can warn that saving overwrites the newer disk version; it is never dropped for that reason. A draft
// whose text equals the disk text carries nothing: `restored: false` and the caller clears the backup.
import type { Draft } from '../edit/draft-backup.ts';
import { endpoint } from './targets.ts';
import type { MdTarget } from './targets.ts';

/** Draft key of one popup editor: `md:<endpoint>#<target id>` (`draft-backup.ts` adds its own prefix). */
export const mdDraftKey = (t: MdTarget): string => `md:${endpoint(t)}#${t.id}`;

export interface DraftRestore {
  /** The text the editor starts with: the draft when restored, else the disk text. */
  text: string;
  /** The draft was restored into the editor (show the banner). */
  restored: boolean;
  /** Restored, and the file changed on disk since the draft was started. */
  stale: boolean;
}

/** `backup` = `loadDraft(key)`; `disk` = the loaded file's text and `lastModified`. */
export function planRestore(
  backup: Draft | null,
  disk: { text: string; lastModified: string },
): DraftRestore {
  if (backup === null || backup.text === disk.text) {
    return { text: disk.text, restored: false, stale: false };
  }
  return { text: backup.text, restored: true, stale: backup.base !== disk.lastModified };
}

/** The banner text of a restored draft (fresh / stale). */
export function restoredMessage(stale: boolean): string {
  return stale
    ? 'Restored unsaved changes; the file changed on disk since — saving overwrites it.'
    : 'Restored unsaved changes from earlier.';
}
