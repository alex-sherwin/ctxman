import { describe, expect, it } from 'vitest';
import { DATASET_IDS, datasetDef, isOkfDatasetId } from '../../src/datasets/registry.ts';
import { DATASET_SCHEMAS } from '../../src/datasets/schemas.ts';
import { parseFrontmatter, validateOkfFile } from '../../src/lib/okf.ts';
import { schemaCommentLine, schemaCommentStatus } from '../../src/lib/schema-comment.ts';
import { linkText, planNewEntry, titleFromName } from '../../src/lib/templates.ts';
import type { PlannedFile } from '../../src/lib/templates.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { validate } from '../../src/datasets/validate.ts';

const ORIGIN = 'http://127.0.0.1:4321';

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

  it('plans only index.md (the entry, no log.md) under data/task/<name>/', () => {
    expect(files.map((f) => f.relPath)).toEqual(['task/fix-login/index.md']);
  });

  it('writes the exact index.md template', () => {
    expect(byPath(files, 'task/fix-login/index.md')).toBe(
      [
        '---',
        'okf_version: "0.2"',
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

  it('honours title and state overrides', () => {
    const custom = planNewEntry('task', 'x', { now, title: 'Custom title', state: 'in-progress' });
    const main = byPath(custom, 'task/x/index.md');
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
      const main = byPath(planNewEntry(dataset, 'demo', { now }), `${dataset}/demo/index.md`);
      expect(main).toContain(`type: ${def.okfType}\n`);
      const hasState = main.includes('\nstate: ');
      expect(hasState).toBe(def.states !== undefined);
      if (def.states) expect(main).toContain(`state: ${def.states[0]?.id}\n`);
      const found = [...main.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(found).toEqual(headings);
    });
  }

  it('kb has no state line', () => {
    expect(byPath(planNewEntry('kb', 'demo', { now }), 'kb/demo/index.md')).not.toContain('state:');
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
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/reference\n' +
        'name: docs\ndescription: "TODO: describe Docs."\ntype: remote-repo\nuri: https://github.com/TODO/docs.git\nowner: me\n',
    );
  });

  it('snippet: a TODO markdown by default, the given markdown as typed, markdown last', () => {
    const [todo] = planNewEntry('snippet', 'commit-rules', { now });
    expect(todo?.relPath).toBe('snippet/commit-rules.yaml');
    expect(todo?.content).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/snippet\n' +
        'name: commit-rules\ndescription: "TODO: describe Commit rules."\nmarkdown: |\n  TODO: write the Commit rules snippet.\n',
    );
    const [given] = planNewEntry('snippet', 'commit-rules', {
      now,
      description: 'How to commit',
      markdown: '## Commits\n\nUse `feat:`.',
    });
    expect(given?.content).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/snippet\n' +
        'name: commit-rules\ndescription: How to commit\nmarkdown: |-\n  ## Commits\n\n  Use `feat:`.\n',
    );
    const [blank] = planNewEntry('snippet', 'commit-rules', { now, markdown: '  \n' });
    expect(blank?.content).toBe(todo?.content);
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
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/reference\n' +
        'name: r1\ndescription: d\ntype: local-repo\npath: /tmp/r1\nsubpath: src\nowner: not-me\n',
    );
    const [named] = planNewEntry('reference', 'r1', {
      now,
      description: 'd',
      type: 'remote-repo',
      uri: 'git@github.com:o/r1.git',
      subpath: 'docs',
      folder: ' r1-main ',
    });
    expect(named?.content).toContain(
      'uri: git@github.com:o/r1.git\nsubpath: docs\nfolder: r1-main\nowner: me\n',
    );
    expect(() =>
      planNewEntry('reference', 'r1', { now, type: 'remote-skill', folder: 'x' }),
    ).toThrow('folder only applies to local-repo, local-folder and remote-repo references');
    expect(() =>
      planNewEntry('reference', 'r1', { now, type: 'local-repo', folder: '.x' }),
    ).toThrow(/^Invalid folder ".x": must be one folder name/);
    const [localDefault] = planNewEntry('reference', 'r1', { now, type: 'local-repo' });
    expect(localDefault?.content).toContain('path: ~/repos/r1\n');
    const [folder] = planNewEntry('reference', 'notes', {
      now,
      description: 'd',
      type: 'local-folder',
      path: '~/Documents/notes',
    });
    expect(folder?.content).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/reference\n' +
        'name: notes\ndescription: d\ntype: local-folder\npath: ~/Documents/notes\nowner: me\n',
    );
    const [folderDefault] = planNewEntry('reference', 'notes', { now, type: 'local-folder' });
    expect(folderDefault?.content).toContain('path: ~/notes\n');
    const [skill] = planNewEntry('reference', 'r2', {
      now,
      description: 'd',
      type: 'remote-skill',
      uri: 'https://github.com/a/b.git',
    });
    expect(skill?.content).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/reference\n' +
        'name: r2\ndescription: d\ntype: remote-skill\nuri: https://github.com/a/b.git\nowner: me\n',
    );
  });

  it('context: name, description, empty links', () => {
    const [file] = planNewEntry('context', 'ctx', { now, description: 'A context' });
    expect(file).toEqual({
      relPath: 'context/ctx.yaml',
      content:
        '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/context\n' +
        'name: ctx\ndescription: A context\nlinks: []\n',
    });
  });

  it('recipe: name, description, defaults, empty contexts and items', () => {
    const [file] = planNewEntry('recipe', 'brief', { now, description: 'A brief' });
    expect(file).toEqual({
      relPath: 'recipe/brief.yaml',
      content:
        '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/recipe\n' +
        'name: brief\ndescription: A brief\ntarget: claude-code\nlayout: grouped\ncontexts: []\nitems: []\n',
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

  it('rejects markdown on datasets other than snippet', () => {
    for (const dataset of ['kb', 'skill', 'reference', 'context'] as const) {
      expect(() => planNewEntry(dataset, 'x', { now, markdown: 'm' }), dataset).toThrow(
        'markdown only applies to snippet entries',
      );
    }
  });

  it('every yaml dataset file starts with exactly one schema comment line', () => {
    for (const dataset of ['reference', 'snippet', 'context', 'recipe'] as const) {
      const [file] = planNewEntry(dataset, 'demo', { now });
      expect(file?.content.startsWith(`${schemaCommentLine(dataset, ORIGIN)}\n`)).toBe(true);
      expect(
        file?.content.split('\n').filter((l) => l.startsWith('# yaml-language-server:')),
      ).toEqual([schemaCommentLine(dataset, ORIGIN)]);
      expect(schemaCommentStatus(dataset, file?.content ?? '')).toBe('ok');
    }
  });

  it('collapses multi-line input to one line so frontmatter stays valid', () => {
    const main = byPath(
      planNewEntry('kb', 'x', { now, title: 'Two\nlines', description: 'a\r\nb' }),
      'kb/x/index.md',
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
            if (relPath === 'index.md') {
              const parsed = parseFrontmatter(file.content);
              expect(parsed.ok && parsed.doc.data.description).toBe(
                description ?? 'TODO: describe Demo.',
              );
            }
          } else if (def.kind === 'skill') {
            const parsed = parseFrontmatter(file.content);
            expect(parsed.ok).toBe(true);
            if (parsed.ok)
              expect(validate(DATASET_SCHEMAS.skill, parsed.doc.data).success).toBe(true);
          } else {
            const data = parseYaml(file.content);
            const result = validate(DATASET_SCHEMAS[dataset], data);
            expect(result.success, file.relPath).toBe(true);
          }
        }
      });
    }
  }
});

describe('planNewEntry tags (okf)', () => {
  it('writes tags as a flow sequence and the rest of the template stays as without tags', () => {
    const plain = byPath(planNewEntry('task', 'x', { now, description: 'd' }), 'task/x/index.md');
    const tagged = byPath(
      planNewEntry('task', 'x', { now, description: 'd', tags: ['docs', 'agent-notes'] }),
      'task/x/index.md',
    );
    expect(plain).toContain('\ntags: []\n');
    expect(tagged).toBe(plain.replace('tags: []', 'tags: [docs, agent-notes]'));
    const parsed = parseFrontmatter(tagged);
    expect(parsed.ok && parsed.doc.data.tags).toEqual(['docs', 'agent-notes']);
  });

  it('output without tags (undefined or empty) is byte-identical', () => {
    const base = planNewEntry('kb', 'x', { now });
    expect(planNewEntry('kb', 'x', { now, tags: [] })).toEqual(base);
    expect(planNewEntry('kb', 'x', { now, tags: undefined })).toEqual(base);
  });

  it('rejects malformed tags and tags on non-okf datasets', () => {
    expect(() => planNewEntry('task', 'x', { now, tags: ['Bad Tag'] })).toThrow(/Invalid tag/);
    expect(() => planNewEntry('task', 'x', { now, tags: ['ok', '-no'] })).toThrow(/"-no"/);
    expect(() => planNewEntry('skill', 'x', { now, tags: ['a'] })).toThrow(/okf/);
    expect(() => planNewEntry('context', 'x', { now, tags: ['a'] })).toThrow(/okf/);
    expect(planNewEntry('skill', 'x', { now, tags: [] })).toHaveLength(1);
  });
});

describe('linkText', () => {
  it('escapes backslashes and square brackets', () => {
    expect(linkText('a[b]c\\d')).toBe('a\\[b\\]c\\\\d');
    expect(linkText('plain')).toBe('plain');
  });
});
