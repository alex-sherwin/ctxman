// Browser-only: what happens after a successful write of the EntryTools (ROUND3_SPEC §E.5). The page is server
// rendered, so it has to be loaded again to show the change. `rememberSave` parks the "Saved ..." message in
// sessionStorage; the reloaded page shows it (`entry-status.ts`).
//   - devReload false (context yaml is not watched by the dev server): reload at once.
//   - devReload true (the write touched a file under data/ that the dev server watches): the dev server reloads
//     the page by itself ~0.7 s later, so the explicit reload is only the fallback (`pnpm start` has no watcher),
//     RELOAD_FALLBACK_MS later, and skipped while the doc editor is open.
import { $docEditing, RELOAD_FALLBACK_MS } from '../../stores/doc-editor.ts';
import { rememberSave } from '../edit/last-save.ts';

/** sessionStorage key of the status an entry page shows after a reload. */
export const STATUS_KEY = (dataset: string, slug: string): string => `entry:${dataset}/${slug}`;

export interface AfterWriteOptions {
  /** True when the dev server reloads the page by itself (default). */
  devReload?: boolean;
  /** Test hooks. */
  reload?: () => void;
  isEditing?: () => boolean;
  delayMs?: number;
}

export function afterWrite(key: string, message: string, opts: AfterWriteOptions = {}): void {
  const { devReload = true } = opts;
  const reload = opts.reload ?? (() => location.reload());
  rememberSave(key, message);
  if (!devReload) {
    reload();
    return;
  }
  const isEditing = opts.isEditing ?? (() => $docEditing.get());
  setTimeout(() => {
    if (!isEditing()) reload();
  }, opts.delayMs ?? RELOAD_FALLBACK_MS);
}
