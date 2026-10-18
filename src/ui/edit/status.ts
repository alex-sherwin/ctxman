// PURE: one save-status shape for every editor (DocEditor, MarkdownModal, DataForm), rendered by SaveBar.
// Feedback is an inline `role="status"` text, never a toast (ROUND2_UI_SPEC D9).
import { formatRelative } from '../../lib/time.ts';
import { plural } from '../../lib/text.ts';
import type { ApiIssue } from './api.ts';

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

/** The save status of the Forge / Inflate stores. */
export interface EditorSaveStatus {
  kind: 'idle' | 'saving' | 'saved' | 'error' | 'deleted';
  /** Epoch ms of the last successful save. */
  at?: number;
  message?: string;
  issues?: ApiIssue[];
}

export interface SaveStatusView {
  kind: 'idle' | 'dirty' | 'error' | 'saved';
  text: string;
}

/**
 * What the Forge / Inflate status line shows. Order: invalid YAML (`yamlProblems` > 0) -> error; saving;
 * error (message + `path: message` issues joined by '; '); dirty -> 'Unsaved changes'; saved with `at` ->
 * `Saved ${relative}`; deleted -> message ?? 'Deleted'; else 'No changes'.
 */
export function saveStatusView(
  status: EditorSaveStatus,
  dirty: boolean,
  nowMs: number,
  yamlProblems = 0,
): SaveStatusView {
  if (yamlProblems > 0) {
    return { kind: 'error', text: `Invalid YAML — ${plural(yamlProblems, 'problem')}` };
  }
  if (status.kind === 'saving') return { kind: 'idle', text: 'Saving…' };
  if (status.kind === 'error') {
    const detail = (status.issues ?? []).map((i) =>
      i.path ? `${i.path}: ${i.message}` : i.message,
    );
    return {
      kind: 'error',
      text: `Save failed: ${[status.message ?? 'unknown error', ...detail].join('; ')}`,
    };
  }
  if (dirty) return { kind: 'dirty', text: 'Unsaved changes' };
  if (status.kind === 'saved' && status.at !== undefined) {
    return {
      kind: 'saved',
      text: `Saved ${formatRelative(new Date(status.at).toISOString(), nowMs)}`,
    };
  }
  if (status.kind === 'deleted') return { kind: 'idle', text: status.message ?? 'Deleted' };
  return { kind: 'idle', text: 'No changes' };
}
