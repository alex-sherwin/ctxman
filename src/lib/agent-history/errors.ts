// PURE (no fs; browser-safe): the failure of an agent history read or import (concepts/agent-history.md). http.ts
// maps it to the API answer: bad-agent / bad-key / invalid 400, not-found 404, too-large 413.
import type { Issue } from '../context-io.ts';

export type AgentHistoryErrorCode = 'bad-agent' | 'bad-key' | 'invalid' | 'not-found' | 'too-large';

export class AgentHistoryError extends Error {
  code: AgentHistoryErrorCode;
  /** For `invalid`: what is wrong with the request body. */
  issues: Issue[];
  constructor(code: AgentHistoryErrorCode, message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'AgentHistoryError';
    this.code = code;
    this.issues = issues;
  }
}
