// "Insert link to entry" glue for any markdown `CodeEditor` (ROUND3_SPEC §F.3/§F.4): holds the picker's open
// state and the editor api, and inserts `[selection || title](ctxman:<ds>/<slug>)` at the cursor on pick.
//
//   const link = useInsertLink();
//   <LazyCodeEditor onReady={link.onReady} onInsertLink={link.open} … />
//   <Button onPress={link.open}>Insert link…</Button>
//   <EntryPicker title="Insert link to entry" {...link.picker} />
//
// `open` moves the focus into the editor BEFORE the dialog mounts. react-aria restores focus, when the dialog
// closes, to the element that had it when the dialog opened; without this a click on the toolbar button would
// leave the focus on the button after the insert (and a following Space would press it again).
// Compose with your own `onReady` if you need the api too. Browser-only; imports no Monaco (types only).
import { useCallback, useRef, useState } from 'react';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { markdownLink } from '../../lib/link-insert.ts';
import type { CodeEditorApi } from '../editor/CodeEditor.tsx';

export interface InsertLinkHandle {
  /** Pass as the editor's `onReady` (call it from yours when you have one). */
  onReady: (api: CodeEditorApi) => void;
  /** Open the picker (button `onPress`, editor `onInsertLink`). */
  open: () => void;
  /** Spread on `<EntryPicker>`: `isOpen`, `onPick`, `onClose`. */
  picker: { isOpen: boolean; onPick: (entry: EntrySummary) => void; onClose: () => void };
}

export function useInsertLink(): InsertLinkHandle {
  const [isOpen, setOpen] = useState(false);
  const apiRef = useRef<CodeEditorApi | null>(null);

  const onReady = useCallback((api: CodeEditorApi) => {
    apiRef.current = api;
  }, []);
  const open = useCallback(() => {
    apiRef.current?.focus();
    setOpen(true);
  }, []);
  const onClose = useCallback(() => setOpen(false), []);
  const onPick = useCallback((entry: EntrySummary) => {
    setOpen(false);
    const api = apiRef.current;
    if (api === null) return;
    api.insertText(
      markdownLink(api.selectedText() || entry.title || entry.name, entry.dataset, entry.slug),
    );
  }, []);

  return { onReady, open, picker: { isOpen, onPick, onClose } };
}
