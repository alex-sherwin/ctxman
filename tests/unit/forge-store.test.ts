import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextDoc } from '../../src/lib/entry-summary.ts';
import {
  $baseline,
  $dirty,
  $linkedKeys,
  $saveStatus,
  $view,
  $working,
  $yamlCheck,
  $yamlDraft,
  $yamlInvalid,
  $yamlMarkers,
  addLink,
  addTag,
  moveLink,
  parseLinkKey,
  removeLink,
  removeTag,
  reorderLinks,
  revert,
  setContextTags,
  setDescription,
  setLinkNotes,
  setView,
  setYamlDraft,
} from '../../src/stores/forge.ts';
import { firstLine, lineCount, plural } from '../../src/ui/forge/notes.ts';
import { nameProblem } from '../../src/ui/forge/validate-name.ts';

const base: ContextDoc = {
  name: 'demo',
  description: 'Demo context',
  tags: ['a'],
  links: [
    { dataset: 'kb', slug: 'one', notes: 'first note\nsecond line\n' },
    { dataset: 'task', slug: 'two' },
  ],
};

function load(doc: ContextDoc = base) {
  $baseline.set(structuredClone(doc));
  $working.set(structuredClone(doc));
}

beforeEach(() => {
  load();
  $view.set('form');
  $yamlDraft.set(null);
  $saveStatus.set({ kind: 'idle' });
});

afterEach(() => {
  $baseline.set(null);
  $working.set(null);
  $yamlDraft.set(null);
  vi.unstubAllGlobals();
});

describe('editing actions', () => {
  it('starts clean and becomes dirty after an edit; revert restores the baseline', () => {
    expect($dirty.get()).toBe(false);
    setDescription('Changed');
    expect($dirty.get()).toBe(true);
    revert();
    expect($dirty.get()).toBe(false);
    expect($working.get()).toEqual(base);
    expect($working.get()).not.toBe($baseline.get());
  });

  it('addLink appends { dataset, slug } without a notes key and ignores duplicates', () => {
    addLink('bug', 'x');
    addLink('bug', 'x');
    const links = $working.get()?.links ?? [];
    expect(links).toHaveLength(3);
    expect(links[2]).toEqual({ dataset: 'bug', slug: 'x' });
    expect(Object.hasOwn(links[2] ?? {}, 'notes')).toBe(false);
    expect($linkedKeys.get().has('bug:x')).toBe(true);
  });

  it('removeLink and moveLink keep the other links and swap with the neighbour', () => {
    addLink('bug', 'x');
    moveLink('bug:x', -1);
    expect($working.get()?.links.map((l) => `${l.dataset}:${l.slug}`)).toEqual([
      'kb:one',
      'bug:x',
      'task:two',
    ]);
    moveLink('kb:one', -1); // already first: no-op
    moveLink('task:two', 1); // already last: no-op
    expect($working.get()?.links[0]?.slug).toBe('one');
    removeLink('bug:x');
    expect($working.get()?.links.map((l) => l.slug)).toEqual(['one', 'two']);
  });

  it('reorderLinks drops links before / after a target (drag and drop) and keeps their notes', () => {
    addLink('bug', 'x');
    const keys = () => $working.get()?.links.map((l) => `${l.dataset}:${l.slug}`);
    reorderLinks(['kb:one'], 'bug:x', 'after');
    expect(keys()).toEqual(['task:two', 'bug:x', 'kb:one']);
    expect($working.get()?.links[2]?.notes).toBe('first note\nsecond line\n');
    reorderLinks(['kb:one', 'bug:x'], 'task:two', 'before');
    expect(keys()).toEqual(['bug:x', 'kb:one', 'task:two']); // current relative order of the moved links
    expect($dirty.get()).toBe(true);
  });

  it('reorderLinks ignores a drop that changes nothing and unknown keys', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    reorderLinks(['kb:one'], 'task:two', 'before'); // already there
    reorderLinks(['kb:one'], 'kb:one', 'after'); // onto itself
    reorderLinks(['kb:one'], 'nope:x', 'after'); // unknown target
    expect($dirty.get()).toBe(false);
    expect($saveStatus.get().kind).toBe('saved');
  });

  it('reorderLinks re-serializes the draft in the YAML view', () => {
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    setView('yaml');
    reorderLinks(['kb:one'], 'task:two', 'after');
    const draft = $yamlDraft.get() ?? '';
    expect(draft.indexOf('slug: two')).toBeLessThan(draft.indexOf('slug: one'));
  });

  it('setContextTags replaces the list', () => {
    setContextTags(['x', 'y']);
    expect($working.get()?.tags).toEqual(['x', 'y']);
    setContextTags([]);
    expect($working.get()?.tags).toEqual([]);
  });

  it('never mutates the previous working copy', () => {
    const before = $working.get();
    expect(before).not.toBeNull();
    const snapshot = JSON.stringify(before);
    addLink('bug', 'x');
    setLinkNotes('kb:one', 'other');
    addTag('b');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("setLinkNotes('') removes the notes key so the doc equals the baseline again", () => {
    setLinkNotes('task:two', 'something');
    expect($dirty.get()).toBe(true);
    setLinkNotes('task:two', '');
    expect(Object.hasOwn($working.get()?.links[1] ?? {}, 'notes')).toBe(false);
    expect($dirty.get()).toBe(false);
  });

  it('addTag ignores blanks and duplicates; removeTag removes', () => {
    addTag('');
    addTag('a');
    addTag('b');
    expect($working.get()?.tags).toEqual(['a', 'b']);
    removeTag('a');
    expect($working.get()?.tags).toEqual(['b']);
  });

  it('an edit clears a stale "saved" status', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    setDescription('x');
    expect($saveStatus.get().kind).toBe('idle');
  });
});

describe('parseLinkKey', () => {
  it('splits on the first colon', () => {
    expect(parseLinkKey('kb:a-b')).toEqual({ dataset: 'kb', slug: 'a-b' });
  });
});

describe('YAML view', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  });

  it('setView(yaml) serializes the working copy; back to form drops the draft', () => {
    setView('yaml');
    expect($view.get()).toBe('yaml');
    expect($yamlDraft.get()).toContain('name: demo');
    expect($yamlCheck.get().ok).toBe(true);
    setView('form');
    expect($view.get()).toBe('form');
    expect($yamlDraft.get()).toBeNull();
  });

  it('a valid edit flows into the working copy (two-way sync)', () => {
    setView('yaml');
    setYamlDraft('name: demo\ndescription: From YAML\nlinks:\n  - dataset: kb\n    slug: only\n');
    expect($yamlInvalid.get()).toBe(false);
    expect($working.get()?.description).toBe('From YAML');
    expect($working.get()?.links.map((l) => l.slug)).toEqual(['only']);
    expect($dirty.get()).toBe(true);
  });

  it('an invalid edit keeps the last valid working copy, blocks the form view, and revert recovers', () => {
    setView('yaml');
    setDescription('kept'); // re-serializes the draft in yaml view
    setYamlDraft('name: demo\ndescription: [broken\n');
    expect($yamlInvalid.get()).toBe(true);
    expect($working.get()?.description).toBe('kept');
    setView('form'); // refused while invalid
    expect($view.get()).toBe('yaml');
    addLink('bug', 'x'); // refused while invalid
    expect($working.get()?.links).toHaveLength(2);
    revert();
    expect($yamlInvalid.get()).toBe(false);
    expect($yamlDraft.get()).toContain('description: Demo context');
  });

  it('refuses a rename', () => {
    setView('yaml');
    setYamlDraft('name: other\ndescription: d\n');
    const check = $yamlCheck.get();
    expect(check.ok).toBe(false);
    expect(check.issues[0]?.message).toContain('name must stay "demo"');
  });

  it('editor markers only carry what the JSON Schema cannot express (no duplicate squiggles)', () => {
    setView('yaml');
    // syntax error: monaco-yaml marks it, so the ctxman owner draws nothing; the issue list still has it
    setYamlDraft('name: demo\ndescription: [broken\n');
    expect($yamlCheck.get().ok).toBe(false);
    expect($yamlMarkers.get()).toEqual([]);
    // unknown key: covered by the schema
    setYamlDraft('name: demo\ndescription: d\nbogus: 1\nlinks: []\n');
    expect($yamlCheck.get().ok).toBe(false);
    expect($yamlMarkers.get()).toEqual([]);
    // duplicate link: zod only
    setYamlDraft(
      'name: demo\ndescription: d\nlinks:\n  - dataset: kb\n    slug: a\n  - dataset: kb\n    slug: a\n',
    );
    expect($yamlMarkers.get()).toHaveLength(1);
    expect($yamlMarkers.get()[0]?.message).toContain('duplicate link');
    expect($yamlMarkers.get()[0]?.startLineNumber).toBe(6);
    // renamed: zod only
    setYamlDraft('name: other\ndescription: d\nlinks: []\n');
    expect($yamlMarkers.get().map((m) => m.message)).toEqual([
      expect.stringContaining('name must stay "demo"'),
    ]);
    // valid
    setYamlDraft('name: demo\ndescription: d\nlinks: []\n');
    expect($yamlMarkers.get()).toEqual([]);
  });

  it('actions re-serialize the draft while the YAML view is open', () => {
    setView('yaml');
    addLink('bug', 'fresh');
    expect($yamlDraft.get()).toContain('slug: fresh');
  });
});

describe('notes helpers', () => {
  it('lineCount ignores trailing newlines', () => {
    expect(lineCount('a\nb\n\n')).toBe(2);
    expect(lineCount('\n\n')).toBe(0);
    expect(lineCount('one')).toBe(1);
  });

  it('firstLine picks the first non-blank line and truncates', () => {
    expect(firstLine('\n  hello world  \nsecond', 60)).toBe('hello world');
    expect(firstLine('abcdefghij', 5)).toBe('abcd…');
    expect(firstLine('', 10)).toBe('');
  });

  it('plural', () => {
    expect(plural(1, 'line')).toBe('1 line');
    expect(plural(2, 'line')).toBe('2 lines');
  });
});

describe('nameProblem', () => {
  it('accepts kebab-case and reports the first problem otherwise', () => {
    expect(nameProblem('auth-refactor')).toBeNull();
    expect(nameProblem('')).toBe('Required');
    expect(nameProblem('Bad Name')).toContain('lowercase letters');
    expect(nameProblem('double--hyphen')).toContain('lowercase letters');
    expect(nameProblem('a'.repeat(65))).toBe('64 characters max');
    expect(nameProblem('taken', new Set(['taken']))).toContain('already exists');
    expect(nameProblem('free', new Set(['taken']))).toBeNull();
  });
});
