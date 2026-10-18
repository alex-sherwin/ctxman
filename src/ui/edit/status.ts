// PURE: one save-status shape for every editor (DocEditor, MarkdownModal, DataForm), rendered by SaveBar.
// Feedback is an inline `role="status"` text, never a toast (ROUND2_UI_SPEC D9).

export type SaveStatusKind = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export interface SaveStatus {
  kind: SaveStatusKind;
  /** Overrides the default text of `kind` (e.g. the server's error message). */
  message?: string;
}

const DEFAULT_TEXT: Record<SaveStatusKind, string> = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
  conflict: 'Changed on disk',
};

/** The text SaveBar shows: `status.message` when given, else the default of its kind. */
export function statusText(status: SaveStatus): string {
  return status.message ?? DEFAULT_TEXT[status.kind];
}
