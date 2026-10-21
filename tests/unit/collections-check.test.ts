import { afterEach, describe, expect, it } from 'vitest';
import { checkCollections } from '../../src/lib/collections-check.ts';
import {
  byRule,
  ruleIds,
  trackTemp,
  validDataTree,
  withYamlComments,
} from './fixtures/data-fixtures.ts';
import { schemaCommentLine } from '../../src/lib/schema-comment.ts';

const ORIGIN = 'http://127.0.0.1:4321';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('checkCollections', () => {
  it('passes a clean data tree and counts every collection file', async () => {
    const result = await checkCollections(tmp.make(validDataTree()));
    expect(result.findings).toEqual([]);
    // kb: 3 md; task: 1 md; skill: SKILL.md; reference + context + recipe yaml
    expect(result.filesChecked).toBe(8);
  });

  it('treats a missing or empty data dir as clean', async () => {
    expect(await checkCollections('/definitely/not/here')).toEqual({
      findings: [],
      filesChecked: 0,
    });
    expect(await checkCollections(tmp.make())).toEqual({ findings: [], filesChecked: 0 });
  });

  it('okf entries: schema issues (all of them) and name mismatch', async () => {
    const dir = tmp.make({
      'idea/oops/index.md': '---\ntype: Idea\nname: different\nstate: done\n---\n',
      'bug/fine/index.md': '---\ntype: Bug\nname: fine\ndescription: d\nstate: fixed\n---\n',
    });
    const { findings } = await checkCollections(dir);
    expect(ruleIds(findings)).toEqual(['collections/name-mismatch', 'collections/schema']);
    const schema = byRule(findings, 'collections/schema').map((f) => f.message);
    expect(schema).toHaveLength(2);
    expect(schema.some((m) => m.startsWith('description:'))).toBe(true);
    expect(schema.some((m) => m.startsWith('state:'))).toBe(true);
    expect(findings.every((f) => f.file === 'idea/oops/index.md')).toBe(true);
  });

  it('okf entries: missing or broken frontmatter is a schema error', async () => {
    const dir = tmp.make({
      'kb/plain/index.md': '# no frontmatter\n',
      'kb/broken/index.md': '---\ntype: a: b\n---\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => [f.file, f.rule, f.severity])).toEqual([
      ['kb/broken/index.md', 'collections/schema', 'error'],
      ['kb/plain/index.md', 'collections/schema', 'error'],
    ]);
  });

  it('docs collection: other markdown must have mapping frontmatter and a loose schema match', async () => {
    const dir = tmp.make({
      ...validDataTree(),
      'kb/demo/concepts/tags-string.md': '---\ntype: T\ntags: not-a-list\n---\n',
      'kb/demo/concepts/bad-yaml.md': '---\ntype: [oops\n---\n',
      'kb/demo/concepts/plain.md': '# no frontmatter is fine for the docs collection\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => f.file)).toEqual([
      'kb/demo/concepts/bad-yaml.md',
      'kb/demo/concepts/tags-string.md',
    ]);
  });

  it('skills: SKILL.md required, strict keys, name must equal the directory', async () => {
    const dir = tmp.make({
      'skill/no-md/notes.txt': 'x',
      'skill/strict/SKILL.md': '---\nname: strict\ndescription: d\ntags: [a]\n---\n',
      'skill/renamed/SKILL.md': '---\nname: other\ndescription: d\n---\n',
      'skill/ok/SKILL.md':
        '---\nname: ok\ndescription: d\nlicense: MIT\nmetadata:\n  version: "1"\n---\n',
      'skill/README.md': 'stray\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => [f.file, f.rule, f.severity])).toEqual([
      ['skill/README.md', 'collections/stray-file', 'warning'],
      ['skill/no-md', 'collections/missing-skill-md', 'error'],
      ['skill/renamed/SKILL.md', 'collections/name-mismatch', 'error'],
      ['skill/strict/SKILL.md', 'collections/schema', 'error'],
    ]);
    expect(byRule(findings, 'collections/schema')[0]?.message).toContain('tags');
  });

  it('reference and context yaml: schema, name vs stem, stray non-.yaml files', async () => {
    const dir = tmp.make(
      withYamlComments({
        'reference/good.yaml':
          'name: good\ndescription: d\ntype: remote-repo\nuri: https://x.test/r.git\nowner: me\n',
        'reference/wrong-type.yaml':
          'name: wrong-type\ndescription: d\ntype: local-repo\nuri: https://x.test\nowner: me\n',
        'reference/other-name.yaml':
          'name: someone-else\ndescription: d\ntype: remote-repo\nuri: git@x.test:o/r.git\nowner: me\n',
        'reference/bad-uri.yaml':
          'name: bad-uri\ndescription: d\ntype: remote-repo\nuri: u\nowner: me\n',
        'reference/old.yml': 'name: old\n',
        'reference/notes.md': 'stray',
        'reference/broken.yaml': 'name: [oops\n',
        'context/empty.yaml': '',
        'context/dup.yaml':
          'name: dup\ndescription: d\nlinks:\n  - dataset: kb\n    slug: a\n  - dataset: kb\n    slug: a\n',
        'context/.hidden.yaml': 'ignored',
      }),
    );
    const { findings } = await checkCollections(dir);
    const summary = findings.map((f) => `${f.file} ${f.rule}`);
    expect(summary).toContain('reference/old.yml collections/stray-file');
    expect(summary).toContain('reference/notes.md collections/stray-file');
    expect(summary).toContain('reference/other-name.yaml collections/name-mismatch');
    expect(summary).toContain('reference/bad-uri.yaml collections/schema');
    expect(summary).toContain('reference/wrong-type.yaml collections/schema');
    expect(summary).toContain('reference/broken.yaml collections/schema');
    expect(summary).toContain('context/empty.yaml collections/schema');
    expect(summary).toContain('context/dup.yaml collections/schema');
    expect(summary.filter((s) => s.startsWith('reference/good.yaml'))).toEqual([]);
    expect(findings.some((f) => f.file.includes('.hidden'))).toBe(false);
    const stray = byRule(findings, 'collections/stray-file');
    expect(stray.every((f) => f.severity === 'warning')).toBe(true);
    expect(stray.find((f) => f.file.endsWith('.yml'))?.message).toContain('.yml');
  });

  it('snippet yaml: schema, name vs stem, stray files; contexts and recipes may link snippets', async () => {
    const dir = tmp.make(
      withYamlComments({
        ...validDataTree(),
        'snippet/good.yaml': 'name: good\ndescription: d\nmarkdown: |\n  Run the checks.\n',
        'snippet/no-markdown.yaml': 'name: no-markdown\ndescription: d\n',
        'snippet/blank.yaml': 'name: blank\ndescription: d\nmarkdown: "  "\n',
        'snippet/other-name.yaml': 'name: someone-else\ndescription: d\nmarkdown: m\n',
        'snippet/notes.md': 'stray',
        'context/uses-snippets.yaml':
          'name: uses-snippets\ndescription: d\nlinks:\n  - dataset: snippet\n    slug: good\n  - dataset: snippet\n    slug: gone\n',
        'recipe/uses-snippet.yaml':
          'name: uses-snippet\ndescription: d\nitems:\n  - dataset: snippet\n    slug: good\n',
      }),
    );
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => `${f.file} ${f.rule} ${f.severity}`)).toEqual([
      'context/uses-snippets.yaml collections/dangling-link warning',
      'snippet/blank.yaml collections/schema error',
      'snippet/no-markdown.yaml collections/schema error',
      'snippet/notes.md collections/stray-file warning',
      'snippet/other-name.yaml collections/name-mismatch error',
    ]);
    expect(byRule(findings, 'collections/dangling-link')[0]?.message).toBe(
      'link snippet/gone does not exist',
    );
    expect(
      byRule(findings, 'collections/schema').find((f) => f.file === 'snippet/no-markdown.yaml')
        ?.message,
    ).toContain('markdown');
  });

  it('dangling context links are warnings only (never errors)', async () => {
    const dir = tmp.make(
      withYamlComments({
        ...validDataTree(),
        'context/dangling.yaml':
          'name: dangling\ndescription: d\nlinks:\n  - dataset: kb\n    slug: demo\n  - dataset: kb\n    slug: gone\n  - dataset: skill\n    slug: missing-skill\n  - dataset: reference\n    slug: nope\n  - dataset: task\n    slug: do-it\n',
      }),
    );
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ['collections/dangling-link', 'warning', 'link kb/gone does not exist'],
      ['collections/dangling-link', 'warning', 'link reference/nope does not exist'],
      ['collections/dangling-link', 'warning', 'link skill/missing-skill does not exist'],
    ]);
  });

  it('warns about unknown top-level directories but ignores files and dot-dirs', async () => {
    const dir = tmp.make({
      'misc/x.md': 'hello',
      '.git/config': '',
      'README.md': 'root readme',
    });
    const { findings } = await checkCollections(dir);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'collections/unknown-dir',
        severity: 'warning',
        file: 'misc',
      }),
    ]);
  });

  describe('recipes', () => {
    const recipe = (body: string) => `name: r\ndescription: d\n${body}`;

    it('recipe yaml: schema errors, name vs stem, stray non-.yaml files', async () => {
      const dir = tmp.make(
        withYamlComments({
          ...validDataTree(),
          'recipe/bad-mode.yaml':
            'name: bad-mode\ndescription: d\noverrides:\n  - key: kb/demo\n    mode: install\n',
          'recipe/other-name.yaml': 'name: someone-else\ndescription: d\n',
          'recipe/old.yml': 'name: old\n',
          'recipe/broken.yaml': 'name: [oops\n',
          'recipe/dup.yaml': 'name: dup\ndescription: d\ncontexts: [a, a]\n',
          'recipe/.hidden.yaml': 'ignored',
        }),
      );
      const { findings } = await checkCollections(dir);
      const summary = findings.map((f) => `${f.file} ${f.rule}`);
      expect(summary).toContain('recipe/bad-mode.yaml collections/schema');
      expect(summary).toContain('recipe/other-name.yaml collections/name-mismatch');
      expect(summary).toContain('recipe/old.yml collections/stray-file');
      expect(summary).toContain('recipe/broken.yaml collections/schema');
      expect(summary).toContain('recipe/dup.yaml collections/schema');
      expect(summary.filter((s) => s.startsWith('recipe/brief.yaml'))).toEqual([]);
      expect(findings.some((f) => f.file.includes('.hidden'))).toBe(false);
    });

    it('collections/recipe-context-missing: a listed context file does not exist', async () => {
      const dir = tmp.make(
        withYamlComments({
          ...validDataTree(),
          'recipe/r.yaml': recipe('contexts:\n  - ctx\n  - gone\n'),
        }),
      );
      const { findings } = await checkCollections(dir);
      expect(findings.map((f) => [f.file, f.rule, f.severity, f.message])).toEqual([
        [
          'recipe/r.yaml',
          'collections/recipe-context-missing',
          'warning',
          'context gone does not exist',
        ],
      ]);
    });

    it('collections/recipe-item-missing: an ad hoc item does not exist', async () => {
      const dir = tmp.make(
        withYamlComments({
          ...validDataTree(),
          'recipe/r.yaml': recipe(
            'items:\n  - dataset: kb\n    slug: demo\n  - dataset: kb\n    slug: gone\n  - dataset: reference\n    slug: nope\n',
          ),
        }),
      );
      const { findings } = await checkCollections(dir);
      expect(findings.map((f) => [f.rule, f.message])).toEqual([
        ['collections/recipe-item-missing', 'item kb/gone does not exist'],
        ['collections/recipe-item-missing', 'item reference/nope does not exist'],
      ]);
    });

    it('collections/recipe-override-stale: an override matches no reachable item', async () => {
      const dir = tmp.make(
        withYamlComments({
          ...validDataTree(),
          'recipe/r.yaml': recipe(
            'contexts:\n  - ctx\nitems:\n  - dataset: skill\n    slug: my-skill\noverrides:\n  - key: kb/demo\n    exclude: true\n  - key: skill/my-skill\n    mode: pointer\n  - key: task/not-linked\n    exclude: true\n',
          ),
        }),
      );
      const { findings } = await checkCollections(dir);
      expect(findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
        [
          'collections/recipe-override-stale',
          'warning',
          'override task/not-linked matches no item of this recipe',
        ],
      ]);
    });

    it('collections/recipe-order-stale: valid keys are contexts, reachable items, blocks and sec:extra', async () => {
      const dir = tmp.make(
        withYamlComments({
          ...validDataTree(),
          'recipe/r.yaml': recipe(
            'contexts:\n  - ctx\nmarkdown:\n  - id: b1\n    body: hi\norder:\n  - md:b1\n  - sec:extra\n  - ctx:ctx\n  - task/do-it\n  - md:b9\n  - ctx:other\n  - kb/gone\n',
          ),
        }),
      );
      const { findings } = await checkCollections(dir);
      expect(findings.map((f) => [f.rule, f.message])).toEqual([
        ['collections/recipe-order-stale', 'order key ctx:other matches nothing in this recipe'],
        ['collections/recipe-order-stale', 'order key kb/gone matches nothing in this recipe'],
        ['collections/recipe-order-stale', 'order key md:b9 matches nothing in this recipe'],
      ]);
    });

    describe('working-directory output (plans/INFLATE_V2_SPEC.md §12)', () => {
      const refs = {
        'reference/rr.yaml':
          'name: rr\ndescription: d\ntype: remote-repo\nuri: https://example.com/o/rr.git\nowner: me\n',
        'reference/rs.yaml':
          'name: rs\ndescription: d\ntype: remote-skill\nuri: https://example.com/o/rs.git\nowner: me\n',
        'reference/lf.yaml':
          'name: lf\ndescription: d\ntype: local-folder\npath: /tmp/lf\nowner: me\n',
        'context/refs.yaml':
          'name: refs\ndescription: d\nlinks:\n  - dataset: reference\n    slug: rr\n',
      };
      const run = async (body: string, extra: Record<string, string> = {}) => {
        const dir = tmp.make(
          withYamlComments({
            ...validDataTree(),
            ...refs,
            ...extra,
            'recipe/r.yaml': recipe(body),
          }),
        );
        const { findings } = await checkCollections(dir);
        return findings
          .filter((f) => f.file === 'recipe/r.yaml')
          .map((f) => [f.rule, f.severity, f.message]);
      };
      const rule = (name: string, message: string) => [`collections/${name}`, 'warning', message];

      it('collections/recipe-output-dir-relative: output.dir must be absolute or ~-prefixed', async () => {
        expect(await run('output:\n  dir: work/dir\n')).toEqual([
          rule(
            'recipe-output-dir-relative',
            'output.dir "work/dir" must be absolute or start with ~/',
          ),
        ]);
        expect(await run('output:\n  dir: ./here\n')).toEqual([
          rule(
            'recipe-output-dir-relative',
            'output.dir "./here" must be absolute or start with ~/',
          ),
        ]);
        for (const dir of ['~/ctxman-inflate/r', '~', '/abs/dir', 'C:\\work', '\\\\srv\\share']) {
          expect(await run(`output:\n  dir: ${JSON.stringify(dir)}\n`), dir).toEqual([]);
        }
        // no dir at all is fine (the dir is chosen at run time)
        expect(await run('output:\n  contextFile: CONTEXT.md\n')).toEqual([]);
      });

      it('collections/recipe-material-invalid: a reference override material its type cannot have', async () => {
        const override = (slug: string, material: string) =>
          `overrides:\n  - key: reference/${slug}\n    material: ${material}\n`;
        // the overrides are not backed by items here: only this rule is under test
        const only = async (body: string, extra?: Record<string, string>) =>
          (await run(body, extra)).filter((f) => f[0] === 'collections/recipe-material-invalid');
        expect(await only(override('repo', 'clone'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "clone" does not apply to reference/repo (Local repo)',
          ),
        ]);
        expect(await only(override('repo', 'install'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "install" does not apply to reference/repo (Local repo)',
          ),
        ]);
        expect(await only(override('rr', 'symlink'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "symlink" does not apply to reference/rr (Remote repo)',
          ),
        ]);
        expect(await only(override('rs', 'clone'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "clone" does not apply to reference/rs (Remote skill)',
          ),
        ]);
        // v3: a copy is a material of local repositories only
        expect(await only(override('rr', 'copy'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "copy" does not apply to reference/rr (Remote repo)',
          ),
        ]);
        expect(await only(override('rs', 'copy'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "copy" does not apply to reference/rs (Remote skill)',
          ),
        ]);
        expect(await only(override('repo', 'copy'))).toEqual([]);
        // applicable materials and "none" are fine; so is an override without material
        expect(await only(override('repo', 'symlink'))).toEqual([]);
        expect(await only(override('repo', 'none'))).toEqual([]);
        expect(await only(override('rr', 'clone'))).toEqual([]);
        expect(await only(override('rs', 'install'))).toEqual([]);
        // a local folder has the materials of a local repository
        expect(await only(override('lf', 'copy'))).toEqual([]);
        expect(await only(override('lf', 'clone'))).toEqual([
          rule(
            'recipe-material-invalid',
            'material "clone" does not apply to reference/lf (Local folder)',
          ),
        ]);
        expect(await only('overrides:\n  - key: reference/repo\n    mode: tree\n')).toEqual([]);
        // missing or schema-invalid references have no type to check against
        expect(await only(override('ghost', 'clone'))).toEqual([]);
        expect(
          await only(override('broken', 'clone'), {
            'reference/broken.yaml':
              'name: broken\ndescription: d\ntype: remote-repo\nuri: nope\nowner: me\n',
          }),
        ).toEqual([]);
        // non-reference keys are validated by the schema itself, not here
        expect(await only('overrides:\n  - key: kb/demo\n    material: copy\n')).toEqual([]);
      });

      it('collections/recipe-primary-invalid: the reference is missing or not a repo', async () => {
        expect(await run('output:\n  primary: reference/ghost\n')).toEqual([
          rule(
            'recipe-primary-invalid',
            'primary reference/ghost must be a remote-repo or local-repo reference',
          ),
        ]);
        expect(await run('output:\n  primary: reference/rs\n')).toEqual([
          rule(
            'recipe-primary-invalid',
            'primary reference/rs must be a remote-repo or local-repo reference',
          ),
        ]);
        // a local folder is not a git repository
        expect(await run('output:\n  primary: reference/lf\n')).toEqual([
          rule(
            'recipe-primary-invalid',
            'primary reference/lf must be a remote-repo or local-repo reference',
          ),
        ]);
      });

      it('collections/recipe-primary-invalid: the effective material must be clone (remote) or symlink (local)', async () => {
        const needs = (key: string) =>
          rule(
            'recipe-primary-invalid',
            `primary ${key} needs material clone (remote-repo) or symlink or worktree (local-repo)`,
          );
        const items = (slug: string) => `items:\n  - dataset: reference\n    slug: ${slug}\n`;
        // v3: the built-in materials (clone for a remote repo, symlink for a local one) are eligible
        expect(await run(`output:\n  primary: reference/rr\n${items('rr')}`)).toEqual([]);
        expect(await run(`output:\n  primary: reference/repo\n${items('repo')}`)).toEqual([]);
        // none and a copy of a local repo (no .git) are not
        expect(
          await run(
            `output:\n  primary: reference/rr\n${items('rr')}overrides:\n  - key: reference/rr\n    material: none\n`,
          ),
        ).toEqual([needs('reference/rr')]);
        expect(
          await run(
            `output:\n  primary: reference/repo\n${items('repo')}overrides:\n  - key: reference/repo\n    material: copy\n`,
          ),
        ).toEqual([needs('reference/repo')]);
        expect(
          await run(
            `output:\n  primary: reference/repo\n${items('repo')}defaults:\n  local-repo:\n    material: none\n`,
          ),
        ).toEqual([needs('reference/repo')]);
        // a worktree of a local repository is a git work tree: a valid primary
        expect(
          await run(
            `output:\n  primary: reference/repo\n${items('repo')}overrides:\n  - key: reference/repo\n    material: worktree\n    materialOptions:\n      newBranch: work\n`,
          ),
        ).toEqual([]);
        // wrong material for the type (symlink on a remote repo) is reported once; the primary check then
        // looks at the override as written, and a symlink is not clone
        expect(
          await run(
            `output:\n  primary: reference/rr\n${items('rr')}overrides:\n  - key: reference/rr\n    material: symlink\n`,
          ),
        ).toEqual([
          rule(
            'recipe-material-invalid',
            'material "symlink" does not apply to reference/rr (Remote repo)',
          ),
          needs('reference/rr'),
        ]);
        // override beats the recipe default
        expect(
          await run(
            `output:\n  primary: reference/rr\n${items('rr')}overrides:\n  - key: reference/rr\n    material: none\ndefaults:\n  remote-repo:\n    material: clone\n`,
          ),
        ).toEqual([needs('reference/rr')]);
        // eligible through the override, the recipe default, or symlink on a local repo
        expect(
          await run(
            `output:\n  primary: reference/rr\n${items('rr')}overrides:\n  - key: reference/rr\n    material: clone\n`,
          ),
        ).toEqual([]);
        expect(
          await run(
            `output:\n  primary: reference/rr\n${items('rr')}defaults:\n  remote-repo:\n    material: clone\n`,
          ),
        ).toEqual([]);
        expect(
          await run(
            `output:\n  primary: reference/repo\n${items('repo')}overrides:\n  - key: reference/repo\n    material: symlink\n`,
          ),
        ).toEqual([]);
      });

      it('collections/recipe-primary-invalid: the primary must be an item (ad hoc or via a context)', async () => {
        const clone = 'overrides:\n  - key: reference/rr\n    material: clone\n';
        const notAnItem = rule(
          'recipe-primary-invalid',
          'primary reference/rr is not an item of this recipe',
        );
        // not listed anywhere
        expect(await run(`output:\n  primary: reference/rr\n${clone}`)).toEqual([
          rule('recipe-override-stale', 'override reference/rr matches no item of this recipe'),
          notAnItem,
        ]);
        expect(await run(`output:\n  primary: reference/rr\ncontexts:\n  - ctx\n${clone}`)).toEqual(
          [
            rule('recipe-override-stale', 'override reference/rr matches no item of this recipe'),
            notAnItem,
          ],
        );
        // reachable through an ad hoc item or a context link
        expect(
          await run(
            `output:\n  primary: reference/rr\nitems:\n  - dataset: reference\n    slug: rr\n${clone}`,
          ),
        ).toEqual([]);
        expect(
          await run(`output:\n  primary: reference/rr\ncontexts:\n  - refs\n${clone}`),
        ).toEqual([]);
        // the reachable set is unknown while a listed context is missing: no verdict
        expect(
          await run(`output:\n  primary: reference/rr\ncontexts:\n  - gone\n${clone}`),
        ).toEqual([rule('recipe-context-missing', 'context gone does not exist')]);
      });
    });

    it('stale checks are skipped while a listed context is missing or invalid', async () => {
      const dir = tmp.make(
        withYamlComments({
          ...validDataTree(),
          'context/broken.yaml': 'name: broken\ndescription: ""\n',
          'recipe/missing.yaml':
            'name: missing\ndescription: d\ncontexts: [gone]\noverrides:\n  - key: kb/x\n    exclude: true\norder: [kb/x]\n',
          'recipe/invalid.yaml':
            'name: invalid\ndescription: d\ncontexts: [broken]\noverrides:\n  - key: kb/x\n    exclude: true\norder: [kb/x]\n',
        }),
      );
      const { findings } = await checkCollections(dir);
      expect(
        findings.filter((f) => f.file.startsWith('recipe/')).map((f) => [f.file, f.rule]),
      ).toEqual([['recipe/missing.yaml', 'collections/recipe-context-missing']]);
    });
  });
});

describe('collections/yaml-schema-comment', () => {
  const body = 'name: x\ndescription: d\nlinks: []\n';
  const run = async (files: Record<string, string>) =>
    byRule((await checkCollections(tmp.make(files))).findings, 'collections/yaml-schema-comment');

  it('is silent when line 1 is the exact comment, also with a BOM or CRLF line endings', async () => {
    const line = schemaCommentLine('context', ORIGIN);
    expect(await run({ 'context/x.yaml': `${line}\n${body}` })).toEqual([]);
    expect(await run({ 'context/x.yaml': `﻿${line}\n${body}` })).toEqual([]);
    expect(await run({ 'context/x.yaml': `${line}\r\n${body.replaceAll('\n', '\r\n')}` })).toEqual(
      [],
    );
  });

  it('warns (line 1) when the comment is missing, naming the line and the fix script', async () => {
    const [finding, ...rest] = await run({ 'context/x.yaml': body });
    expect(rest).toEqual([]);
    expect(finding).toEqual({
      severity: 'warning',
      rule: 'collections/yaml-schema-comment',
      file: 'context/x.yaml',
      line: 1,
      message: `first line must be "${schemaCommentLine('context', ORIGIN)}" (pnpm run fix:yaml-comments adds it)`,
    });
  });

  it('warns when another yaml-language-server comment is in place (wrong dataset, other path)', async () => {
    const wrongDataset = await run({
      'context/x.yaml': `${schemaCommentLine('recipe', ORIGIN)}\n${body}`,
    });
    expect(wrongDataset).toHaveLength(1);
    expect(wrongDataset[0]).toMatchObject({
      severity: 'warning',
      line: 1,
      message:
        "schema comment must point at this server's /api/schemas/context (pnpm run fix:yaml-comments fixes it)",
    });
    expect(
      await run({ 'context/x.yaml': `# yaml-language-server: $schema=./nope.json\n${body}` }),
    ).toHaveLength(1);
  });

  it('applies per dataset and still reports when the file is otherwise invalid', async () => {
    const findings = await run({
      'reference/a.yaml': 'name: a\n',
      'recipe/b.yaml': 'name: [oops\n',
      'context/c.yaml': `${schemaCommentLine('context', ORIGIN)}\n${body}`,
    });
    expect(findings.map((f) => f.file)).toEqual(['recipe/b.yaml', 'reference/a.yaml']);
  });
});
