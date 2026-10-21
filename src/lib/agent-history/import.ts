// NODE: imports an agent session or plan into an okf bundle as a new concept file (concepts/agent-history.md,
// plans/AGENT_HISTORY_SPEC.md §5). The body is validated (arktype through validate()), the target is checked before
// the history is read, the key is resolved by listing its source again, and doc-io#createDocFile is the only writer
// (never overwrites, keeps index.md / log.md, answers the validator's warnings).
import { type } from 'arktype';
import { validate } from '../../datasets/validate.ts';
import type { Issue } from '../context-io.ts';
import { CONCEPT_TITLE_MAX, checkNewDocTarget, createDocFile } from '../doc-io.ts';
import { resolveDataDir } from '../data-dir.ts';
import { describeIssue, issuePath } from '../findings.ts';
import { AgentHistoryError } from './errors.ts';
import { DEFAULT_SESSION_OPTIONS, indexLineText } from './markdown.ts';
import type { GeneratedFile } from './markdown.ts';
import { oneLine } from './parse-util.ts';
import { planFile, readAgentPlan } from './plans.ts';
import { readAgentSession, sessionFile } from './sessions.ts';
import { parseAgentKey } from './types.ts';
import type { AgentImported, AgentPlanImportBody, AgentSessionImportBody } from './types.ts';

export const agentSessionImportBodySchema = type({
  '+': 'reject',
  key: 'string',
  dataset: 'string',
  slug: 'string',
  path: 'string',
  'title?': 'string',
  'tools?': 'boolean',
  'thinking?': 'boolean',
});

export const agentPlanImportBodySchema = type({
  '+': 'reject',
  key: 'string',
  dataset: 'string',
  slug: 'string',
  path: 'string',
  'title?': 'string',
});

export interface ImportOptions {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

function invalid(issues: Issue[]): AgentHistoryError {
  return new AgentHistoryError('invalid', 'request body is invalid', issues);
}

/** A title override: one line, not blank, at most CONCEPT_TITLE_MAX characters; undefined = the default title. */
function titleOverride(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const title = oneLine(raw);
  if (title === '') throw invalid([{ path: 'title', message: 'must not be blank' }]);
  if (Array.from(title).length > CONCEPT_TITLE_MAX) {
    throw invalid([{ path: 'title', message: `must be at most ${CONCEPT_TITLE_MAX} characters` }]);
  }
  return title;
}

function parseBody<
  S extends typeof agentSessionImportBodySchema | typeof agentPlanImportBodySchema,
>(schema: S, body: unknown): S['infer'] {
  const parsed = validate(schema, body);
  if (!parsed.success) {
    throw invalid(
      parsed.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: describeIssue(issue, body ?? {}),
      })),
    );
  }
  if (parseAgentKey(parsed.data.key) === null) {
    throw new AgentHistoryError('bad-key', `"${parsed.data.key}" is not a key (<source>:<id>)`);
  }
  return parsed.data;
}

async function write(
  target: { dataset: string; slug: string; path: string },
  file: GeneratedFile,
  options: ImportOptions,
  dataDir: string,
): Promise<AgentImported> {
  const created = await createDocFile(
    target.dataset,
    target.slug,
    target.path,
    {
      // index.md and log.md lines are markdown: no raw HTML from the history. The title only, no description: the
      // entry index.md is searchable, and its ## Links line must not carry the session's cwd, dates or prompt counts.
      title: indexLineText(file.title, { brackets: false }),
      markdown: file.markdown,
    },
    dataDir,
    options.now,
  );
  return {
    path: created.path,
    url: created.url,
    lastModified: created.lastModified,
    warnings: created.warnings,
  };
}

/**
 * `POST /api/agent-sessions/import`. Throws AgentHistoryError (invalid, bad-key, not-found, too-large) or DocIoError
 * (bad-dataset, bad-slug, bad-path, not-found, exists).
 */
export async function importAgentSession(
  body: unknown,
  options: ImportOptions = {},
): Promise<AgentImported> {
  const input: AgentSessionImportBody = parseBody(agentSessionImportBodySchema, body);
  const title = titleOverride(input.title);
  const dataDir = options.dataDir ?? resolveDataDir();
  checkNewDocTarget(input.dataset, input.slug, input.path, dataDir);
  const read = await readAgentSession(input.key, options.env);
  const file = sessionFile(
    read,
    {
      tools: input.tools ?? DEFAULT_SESSION_OPTIONS.tools,
      thinking: input.thinking ?? DEFAULT_SESSION_OPTIONS.thinking,
    },
    title ?? read.summary.title,
    options.now ?? new Date(),
  );
  return write(input, file, options, dataDir);
}

/** `POST /api/agent-plans/import`. Same errors as importAgentSession. */
export async function importAgentPlan(
  body: unknown,
  options: ImportOptions = {},
): Promise<AgentImported> {
  const input: AgentPlanImportBody = parseBody(agentPlanImportBodySchema, body);
  const title = titleOverride(input.title);
  const dataDir = options.dataDir ?? resolveDataDir();
  checkNewDocTarget(input.dataset, input.slug, input.path, dataDir);
  const read = await readAgentPlan(input.key, options.env);
  const file = planFile(read, title ?? read.summary.title, options.now ?? new Date());
  return write(input, file, options, dataDir);
}
