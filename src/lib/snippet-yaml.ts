// PURE (no fs, no astro:*; browser-safe): the deterministic YAML form of a snippet and its validation, shared by
// snippet-io.ts (file writes) and islands (YAML preview). The yaml-language-server comment is NOT part of the
// serializer: file writers add it with `withSchemaComment('snippet', ...)` (schema-comment.ts).
import { snippetSchema } from '../datasets/schemas.ts';
import type { SnippetData, SnippetInput } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { describeIssue, issuePath } from './findings.ts';
import { stringifyYaml } from './yaml.ts';

/** API body type (schema input, before defaults). */
export type SnippetDoc = SnippetInput;

/** One validation problem; `path` is the issue path joined with '.', '' for the root. */
export interface SnippetIssue {
  path: string;
  message: string;
}

/**
 * The plain object that is serialized. Key order: name, description, tags (omitted when empty), markdown (last, a
 * literal block scalar). Matches the seed files and the `add:snippet` template.
 */
export function snippetToYamlObject(s: SnippetData): Record<string, unknown> {
  const doc: Record<string, unknown> = { name: s.name, description: s.description };
  if (s.tags.length > 0) doc.tags = s.tags;
  doc.markdown = s.markdown;
  return doc;
}

/** Deterministic YAML text of a snippet (ends with a newline, no schema comment). */
export function serializeSnippet(s: SnippetData): string {
  return stringifyYaml(snippetToYamlObject(s));
}

/** True when both snippets serialize to the same document (null equals only null). */
export function sameSnippet(a: SnippetData | null, b: SnippetData | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(snippetToYamlObject(a)) === JSON.stringify(snippetToYamlObject(b));
}

/**
 * validate(snippetSchema, …) plus an optional `name === expectedName` check (code 'name-mismatch': snippet names
 * cannot be changed).
 */
export function parseSnippet(
  input: unknown,
  expectedName?: string,
):
  | { ok: true; snippet: SnippetData }
  | { ok: false; code: 'invalid' | 'name-mismatch'; issues: SnippetIssue[] } {
  const parsed = validate(snippetSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      issues: parsed.issues.map((i) => ({
        path: issuePath(i.path),
        message: describeIssue(i, input ?? {}),
      })),
    };
  }
  if (expectedName !== undefined && parsed.data.name !== expectedName) {
    return {
      ok: false,
      code: 'name-mismatch',
      issues: [
        {
          path: 'name',
          message: `name must equal "${expectedName}" (snippet names cannot be changed)`,
        },
      ],
    };
  }
  return { ok: true, snippet: parsed.data };
}
