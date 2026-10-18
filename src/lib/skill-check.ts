// NODE (no fs calls of its own; imports okf.ts): the SKILL.md rules of `collections/*` for ONE file, so the
// compliance check (collections-check.ts) and the doc editor (doc-io.ts) report the same findings.
// Rule ids: collections/schema (frontmatter parse + agentskills.io strict schema), collections/name-mismatch.
import { skillSchema } from '../datasets/schemas.ts';
import { issueMessage } from './findings.ts';
import type { Finding } from './findings.ts';
import { parseFrontmatter } from './okf.ts';

/**
 * Findings for the text of `<dirName>/SKILL.md`: frontmatter that does not parse (one `collections/schema`
 * error, line from the parse error), skillSchema issues (strict: unknown keys are errors), and a `name` that
 * differs from the directory name. `file` is used verbatim as the data-dir-relative path of each finding.
 */
export function validateSkillFile(source: string, dirName: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, message: string, line?: number): void => {
    findings.push(
      line === undefined
        ? { severity: 'error', rule, file, message }
        : { severity: 'error', rule, file, line, message },
    );
  };

  const parsed = parseFrontmatter(source);
  if (!parsed.ok) {
    add('collections/schema', `frontmatter: ${parsed.error}`, parsed.line);
    return findings;
  }
  // Strict (agentskills.io): unknown keys are errors.
  const result = skillSchema.safeParse(parsed.doc.data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      add('collections/schema', issueMessage(issue, parsed.doc.data));
    }
  }
  const name = parsed.doc.data.name;
  if (typeof name === 'string' && name !== dirName) {
    add('collections/name-mismatch', `name "${name}" must equal the directory name "${dirName}"`);
  }
  return findings;
}
