// PURE (no fs, no astro:*; browser-safe): the deterministic YAML form of a reference and its validation, shared by
// reference-io.ts (file writes) and islands (YAML preview). The yaml-language-server comment is NOT part of
// the serializer: file writers add it with `withSchemaComment('reference', ...)` (schema-comment.ts).
import { referenceSchema } from '../datasets/schemas.ts';
import type { ReferenceData, ReferenceInput } from '../datasets/schemas.ts';
import { describeIssue, issuePath } from './findings.ts';
import { stringifyYaml } from './yaml.ts';

/** API body type (zod input, before defaults). */
export type ReferenceDoc = ReferenceInput;

/** One validation problem; `path` is the zod issue path joined with '.', '' for the root. */
export interface ReferenceIssue {
  path: string;
  message: string;
}

/**
 * The plain object that is serialized. Key order: name, description, type, path (local-repo) | uri
 * (remote-*), subpath (omitted when undefined / null / ''), owner, tags (omitted when empty). Matches every
 * seed file and the `add:reference` template.
 */
export function referenceToYamlObject(r: ReferenceData): Record<string, unknown> {
  const doc: Record<string, unknown> = { name: r.name, description: r.description, type: r.type };
  if (r.type === 'local-repo') doc.path = r.path;
  else doc.uri = r.uri;
  if (r.subpath !== undefined && r.subpath !== null && r.subpath !== '') doc.subpath = r.subpath;
  doc.owner = r.owner;
  if (r.tags.length > 0) doc.tags = r.tags;
  return doc;
}

/** Deterministic YAML text of a reference (ends with a newline, no schema comment). */
export function serializeReference(r: ReferenceData): string {
  return stringifyYaml(referenceToYamlObject(r));
}

/** True when both references serialize to the same document (null equals only null). */
export function sameReference(a: ReferenceData | null, b: ReferenceData | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(referenceToYamlObject(a)) === JSON.stringify(referenceToYamlObject(b));
}

/**
 * referenceSchema.safeParse plus an optional `name === expectedName` check (code 'name-mismatch': reference
 * names cannot be changed).
 */
export function parseReference(
  input: unknown,
  expectedName?: string,
):
  | { ok: true; reference: ReferenceData }
  | { ok: false; code: 'invalid' | 'name-mismatch'; issues: ReferenceIssue[] } {
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      issues: parsed.error.issues.map((i) => ({
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
          message: `name must equal "${expectedName}" (reference names cannot be changed)`,
        },
      ],
    };
  }
  return { ok: true, reference: parsed.data };
}
