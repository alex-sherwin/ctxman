// Browser-only: what happens after a successful write of the EntryTools (ROUND3_SPEC §E.5). The page is server
// rendered, so it has to be loaded again to show the change. `rememberSave` parks the "Saved ..." message in
// sessionStorage; the reloaded page shows it (`entry-status.ts`). The data is read from disk on every request,
// so the reload is immediate (no file watcher is involved, in dev and in a built server alike); it is skipped
// while the doc editor is open (the editor's own save flow handles that page).
import { $docEditing } from '../../stores/doc-editor.ts';
import { rememberSave } from '../edit/last-save.ts';

/** sessionStorage key of the status an entry page shows after a reload. */
export const STATUS_KEY = (dataset: string, slug: string): string => `entry:${dataset}/${slug}`;

export interface AfterWriteOptions {
  /** Test hooks. */
  reload?: () => void;
  isEditing?: () => boolean;
}

export function afterWrite(key: string, message: string, opts: AfterWriteOptions = {}): void {
  const reload = opts.reload ?? (() => location.reload());
  const isEditing = opts.isEditing ?? (() => $docEditing.get());
  rememberSave(key, message);
  if (!isEditing()) reload();
}
