import { describe, expect, it } from 'vitest';
import { DATASET_IDS, datasetDef, isOkfDatasetId } from '../../src/datasets/registry.ts';
import { DATASET_SCHEMAS } from '../../src/datasets/schemas.ts';
import { parseFrontmatter, validateOkfFile } from '../../src/lib/okf.ts';
import { planNewEntry, titleFromName } from '../../src/lib/templates.ts';
import type { PlannedFile } from '../../src/lib/templates.ts';
import { parseYaml } from '../../src/lib/yaml.ts';

const now = new Date('2026-10-17T12:34:56.789Z');
const byPath = (files: PlannedFile[], rel: string): string => {
  const hit = files.find((f) => f.relPath === rel);
  if (!hit) throw new Error(`no planned file ${rel}`);
  return hit.content;
};

describe('titleFromName', () => {
  it('turns kebab-case into a sentence-case title', () => {
    expect(titleFromName('fix-login-bug')).toBe('Fix login bug');
    expect(titleFromName('demo')).toBe('Demo');
    expect(titleFromName('a1-b2')).toBe('A1 b2');
  });
});

describe('planNewEntry okf lifecycle dataset (task)', () => {
  const files = planNewEntry('task', 'fix-login', { now, description: 'Fix the login flow' });

  it('plans index.md, main.md and log.md under data/task/<name>/', () => {
    expect(files.map((f) => f.relPath)).toEqual([
      'task/fix-login/index.md',
      'task/fix-login/main.md',
      'task/fix-login/log.md',
    ]);
  });

  it('writes the exact index.md template', () => {
    expect(byPath(files, 'task/fix-login/index.md')).toBe(
      '---\nokf_version: "0.2"\n---\n# Fix login\n\n## Entry\n\n* [Fix login](/main.md) - Fix the login flow\n',
    );
  });

  it('writes the exact main.md template', () => {
    expect(byPath(files, 'task/fix-login/main.md')).toBe(
      [
        '---',
        'type: Task',
        'name: fix-login',
        'title: Fix login',
        'description: Fix the login flow',
        'state: pending',
        'tags: []',
        'generated:',
        '  by: process:ctxman-add-entry',
        '  at: 2026-10-17T12:34:56.789Z',
        '---',
        '',
        '# Fix login',
        '',
        'Fix the login flow',
        '',
        '## Goal',
        '',
        '## Steps',
        '',
        '## Done when',
        '',
      ].join('\n'),
    );
  });

  it('writes the exact log.md template', () => {
    expect(byPath(files, 'task/fix-login/log.md')).toBe(
      '# Update log\n\n## 2026-10-17\n* **Create**: Created [Fix login](/main.md).\n',
    );
  });

  it('honours title and state overrides', () => {
    const custom = planNewEntry('task', 'x', { now, title: 'Custom title', state: 'in-progress' });
    const main = byPath(custom, 'task/x/main.md');
    expect(main).toContain('title: Custom title');
    expect(main).toContain('state: in-progress');
  });
});

describe('planNewEntry per okf dataset', () => {
  const sections: Record<string, string[]> = {
    kb: ['Overview', 'Details'],
    rca: ['Summary', 'Timeline', 'Root cause', 'Resolution', 'Prevention'],
    idea: ['Problem', 'Proposal', 'Open questions'],
    task: ['Goal', 'Steps', 'Done when'],
    bug: ['Symptoms', 'Reproduction', 'Expected vs actual', 'Diagnosis', 'Fix'],
    feature: ['Motivation', 'Requirements', 'Design', 'Acceptance criteria'],
    project: ['Goals', 'Scope', 'Milestones', 'Related'],
  };

  for (const [dataset, headings] of Object.entries(sections)) {
    it(`${dataset}: type, sections and state line match the registry`, () => {
      if (!isOkfDatasetId(dataset)) throw new Error('not okf');
      const def = datasetDef(dataset);
      const main = byPath(planNewEntry(dataset, 'demo', { now }), `${dataset}/demo/main.md`);
      expect(main).toContain(`type: ${def.okfType}\n`);
      const hasState = main.includes('\nstate: ');
      expect(hasState).toBe(def.states !== undefined);
      if (def.states) expect(main).toContain(`state: ${def.states[0]?.id}\n`);
      const found = [...main.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(found).toEqual(headings);
    });
  }

  it('kb has no state line', () => {
    expect(byPath(planNewEntry('kb', 'demo', { now }), 'kb/demo/main.md')).not.toContain('state:');
  });
});

describe('planNewEntry skill, reference, context', () => {
  it('skill: SKILL.md with only name and description', () => {
    const files = planNewEntry('skill', 'my-skill', { now, description: 'Does things' });
    expect(files).toEqual([
      {
        relPath: 'skill/my-skill/SKILL.md',
        content:
          '---\nname: my-skill\ndescription: Does things\n---\n\n# My skill\n\n## When to use\n\n## Instructions\n',
      },
    ]);
  });

  it('reference defaults: remote-repo, owner me, TODO uri', () => {
    const [file] = planNewEntry('reference', 'docs', { now });
    expect(file?.relPath).toBe('reference/docs.yaml');
    expect(file?.content).toBe(
      'name: docs\ndescription: "TODO: describe Docs."\ntype: remote-repo\nuri: https://github.com/TODO/docs.git\nowner: me\n',
    );
  });

  it('reference variants use path / uri / subpath / owner in a fixed order', () => {
    const [local] = planNewEntry('reference', 'r1', {
      now,
      description: 'd',
      type: 'local-repo',
      path: '/tmp/r1',
      subpath: 'src',
      owner: 'not-me',
    });
    expect(local?.content).toBe(
      'name: r1\ndescription: d\ntype: local-repo\npath: /tmp/r1\nsubpath: src\nowner: not-me\n',
    );
    const [localDefault] = planNewEntry('reference', 'r1', { now, type: 'local-repo' });
    expect(localDefault?.content).toContain('path: ~/repos/r1\n');
    const [skill] = planNewEntry('reference', 'r2', {
      now,
      description: 'd',
      type: 'remote-skill',
      uri: 'https://github.com/a/b.git',
    });
    expect(skill?.content).toBe(
      'name: r2\ndescription: d\ntype: remote-skill\nuri: https://github.com/a/b.git\nowner: me\n',
    );
  });

  it('context: name, description, empty links', () => {
    const [file] = planNewEntry('context', 'ctx', { now, description: 'A context' });
    expect(file).toEqual({
      relPath: 'context/ctx.yaml',
      content: 'name: ctx\ndescription: A context\nlinks: []\n',
    });
  });
});

describe('planNewEntry validation', () => {
  it('rejects invalid names with the shared help text', () => {
    for (const bad of ['Bad', '-a', 'a-', 'a--b', 'a b', '../x', '']) {
      expect(() => planNewEntry('kb', bad, { now }), bad).toThrow(/lowercase letters/);
    }
    expect(() => planNewEntry('kb', 'a'.repeat(65), { now })).toThrow(/64/);
  });

  it('rejects an unknown or unsupported state', () => {
    expect(() => planNewEntry('task', 'x', { now, state: 'done' })).toThrow(/Invalid state/);
    expect(() => planNewEntry('bug', 'x', { now, state: 'complete' })).toThrow(/Invalid state/);
    expect(() => planNewEntry('kb', 'x', { now, state: 'pending' })).toThrow(/no lifecycle/);
  });

  it('rejects type on non-reference datasets and invalid reference options', () => {
    expect(() => planNewEntry('kb', 'x', { now, type: 'local-repo' })).toThrow(/reference/);
    expect(() => planNewEntry('reference', 'x', { now, type: 'nope' as never })).toThrow(
      /reference type/,
    );
    expect(() => planNewEntry('reference', 'x', { now, owner: 'them' as never })).toThrow(/owner/);
  });

  it('collapses multi-line input to one line so frontmatter stays valid', () => {
    const main = byPath(
      planNewEntry('kb', 'x', { now, title: 'Two\nlines', description: 'a\r\nb' }),
      'kb/x/main.md',
    );
    expect(main).toContain('title: Two lines\n');
    expect(main).toContain('description: a b\n');
  });
});

describe('planned files validate against the schemas', () => {
  const tricky = 'Tricky: "quotes" # hash [brackets] & more';

  for (const dataset of DATASET_IDS) {
    for (const description of [undefined, tricky]) {
      it(`${dataset} (${description === undefined ? 'default' : 'tricky'} description)`, () => {
        const def = datasetDef(dataset);
        const opts = {
          now,
          ...(description === undefined ? {} : { description, title: 'A [title] here' }),
        };
        const files = planNewEntry(dataset, 'demo', opts);
        for (const file of files) {
          if (def.kind === 'okf' && isOkfDatasetId(dataset)) {
            const relPath = file.relPath.slice(`${dataset}/demo/`.length);
            const findings = validateOkfFile({
              dataset,
              bundle: 'demo',
              relPath,
              source: file.content,
              file: file.relPath,
            });
            expect(findings, file.relPath).toEqual([]);
            if (relPath === 'main.md') {
              const parsed = parseFrontmatter(file.content);
              expect(parsed.ok && parsed.doc.data.description).toBe(
                description ?? 'TODO: describe Demo.',
              );
            }
          } else if (def.kind === 'skill') {
            const parsed = parseFrontmatter(file.content);
            expect(parsed.ok).toBe(true);
            if (parsed.ok)
              expect(DATASET_SCHEMAS.skill.safeParse(parsed.doc.data).success).toBe(true);
          } else {
            const data = parseYaml(file.content);
            const result = DATASET_SCHEMAS[dataset].safeParse(data);
            expect(result.success, file.relPath).toBe(true);
          }
        }
      });
    }
  }
});
