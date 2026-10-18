// Test helpers: temp data directories built in code (never the repo's tests/data; use corpus.ts for a copy). Fixtures are generated rather than
// stored as .md/.yaml files so oxfmt does not rewrite deliberately malformed content.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Finding } from '../../../src/lib/findings.ts';
import { fixSchemaComment, isSchemaDatasetId } from '../../../src/lib/schema-comment.ts';

/** Creates temp dirs and removes them all in `cleanup()` (call from afterEach). */
export function trackTemp(): { make(files?: Record<string, string>): string; cleanup(): void } {
  const dirs: string[] = [];
  return {
    make(files = {}) {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-test-'));
      dirs.push(dir);
      writeTree(dir, files);
      return dir;
    },
    cleanup() {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Writes `{ 'kb/x/index.md': '...' }` below `root` (posix keys; parent dirs created). */
export function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export const ruleIds = (findings: readonly Finding[]): string[] =>
  [...new Set(findings.map((f) => f.rule))].sort();

export const byRule = (findings: readonly Finding[], rule: string): Finding[] =>
  findings.filter((f) => f.rule === rule);

/**
 * Gives every `reference|context|recipe/<name>.yaml` of a fixture tree its yaml-language-server schema comment
 * (line 1) so tests about other rules do not see `collections/yaml-schema-comment` warnings. Files that
 * already start with the comment, and every other file, are left as they are.
 */
export function withYamlComments(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([rel, content]) => {
      const [dataset, name] = rel.split('/');
      const isYaml = rel.split('/').length === 2 && name?.endsWith('.yaml');
      return [
        rel,
        isYaml && isSchemaDatasetId(dataset)
          ? fixSchemaComment(dataset, content, 'http://127.0.0.1:4321')
          : content,
      ];
    }),
  );
}

/** A bundle that passes every check (kb/demo). */
export function validKbBundle(name = 'demo'): Record<string, string> {
  return {
    [`kb/${name}/index.md`]: `---\nokf_version: "0.2"\ntype: Knowledge Base\nname: ${name}\ntitle: Demo\ndescription: A demo knowledge base entry.\ntags: [demo]\nstale_after: 2099-01-01\ngenerated:\n  by: process:test\n  at: 2026-10-17T00:00:00Z\n---\n\n# Demo\n\nSee [one](/concepts/one.md) and [ctxman](ctxman:kb/${name}).\n`,
    [`kb/${name}/concepts/one.md`]: `---\ntype: Concept\ndescription: First concept.\nsources:\n  - id: spec\n    resource: https://example.test/spec\n---\n\n# One\n\nBack to [entry](../index.md#demo). A claim.[^spec] Another.[^note]\n\n[^note]: A note.\n`,
    [`kb/${name}/log.md`]: `# Update log\n\n## 2026-10-18\n* **Update**: Edited.\n\n## 2026-10-17\n* **Create**: Created [Demo](/index.md).\n`,
  };
}

/** A complete tiny data dir (every dataset represented) that passes every check. */
export function validDataTree(): Record<string, string> {
  return withYamlComments({
    ...validKbBundle('demo'),
    'task/do-it/index.md': `---\nokf_version: "0.2"\ntype: Task\nname: do-it\ndescription: Do the thing.\nstate: in-progress\n---\n\n# Do it\n`,
    'skill/my-skill/SKILL.md': `---\nname: my-skill\ndescription: A skill.\n---\n\n# My skill\n\nSee [checklist](references/checklist.md).\n`,
    'skill/my-skill/references/checklist.md': `# Checklist\n\n- one\n`,
    'reference/repo.yaml': `name: repo\ndescription: A repo.\ntype: local-repo\npath: /tmp/repo\nowner: me\n`,
    'context/ctx.yaml': `name: ctx\ndescription: A context.\nlinks:\n  - dataset: kb\n    slug: demo\n    notes: |\n      Read this.\n  - dataset: task\n    slug: do-it\n`,
    'recipe/brief.yaml': `name: brief\ndescription: A brief.\ntarget: claude-code\nlayout: grouped\ncontexts:\n  - ctx\nitems:\n  - dataset: skill\n    slug: my-skill\noverrides:\n  - key: kb/demo\n    mode: inline-bundle\norder:\n  - ctx:ctx\n  - kb/demo\n`,
  });
}
