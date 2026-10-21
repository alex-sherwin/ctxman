// Browser-safe + PURE: the texts of the Log time dialog (LogTimeDialog.tsx), shared by the list rows (ListTable) and
// the entry pages (EntryTools). Unit-tested in tests/unit/log-time.test.ts.
import type { DatasetId } from '../../datasets/registry.ts';
import { formatSeconds, totalDurationSeconds } from '../../lib/iso8601.ts';
import type { ApiIssue } from './api.ts';

/** What the entry is called in the dialog title and the message: its title, else its name. */
export interface LogTimeTarget {
  dataset: DatasetId;
  slug: string;
  title: string;
}

/**
 * The message after a successful PATCH: `Logged PT1H on “Fix login” (total 2h 30m)`. `time` is the `time` key of the
 * frontmatter the server answered with; the total is left out when it has no fixed value (years / months, a value
 * that is not a duration) or the key is missing.
 */
export function loggedMessage(duration: string, title: string, time: unknown): string {
  const total = Array.isArray(time)
    ? totalDurationSeconds(time.filter((t): t is string => typeof t === 'string'))
    : null;
  return `Logged ${duration} on “${title}”${total === null ? '' : ` (total ${formatSeconds(total)})`}`;
}

/** The error line under the field: the server's issues (`path: message`, joined by '; '), else its message. */
export function logTimeError(res: { message: string; issues?: readonly ApiIssue[] }): string {
  return res.issues && res.issues.length > 0
    ? res.issues.map((i) => `${i.path === '' ? '' : `${i.path}: `}${i.message}`).join('; ')
    : res.message;
}
