import { describe, expect, it } from 'vitest';
import {
  DATASET_IDS,
  DATASETS,
  ENTRY_REL_INVERSE_LABELS,
  ENTRY_REL_LABELS,
  ENTRY_RELS,
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAV_DATASET_IDS,
  OKF_DATASET_IDS,
  datasetDef,
  docUrl,
  entryUrl,
  getDataset,
  isDatasetId,
  isEntryRel,
  isLinkableDatasetId,
  isOkfDatasetId,
  isReferenceType,
  isValidName,
  stateGroup,
  stateLabel,
} from '../../src/datasets/registry.ts';
import type { DatasetId } from '../../src/datasets/registry.ts';

describe('dataset registry', () => {
  it('lists the 12 datasets in the canonical order', () => {
    expect([...DATASET_IDS]).toEqual([
      'kb',
      'rca',
      'idea',
      'task',
      'bug',
      'feature',
      'project',
      'skill',
      'reference',
      'snippet',
      'context',
      'recipe',
    ]);
    expect(DATASETS.map((d) => d.id)).toEqual([...DATASET_IDS]);
  });

  it('uses the nav labels from the UI spec', () => {
    expect(DATASETS.map((d) => d.navLabel)).toEqual([
      'KB',
      'RCA',
      'Ideas',
      'Tasks',
      'Bugs',
      'Features',
      'Projects',
      'Skills',
      'References',
      'Snippets',
      'Contexts',
      'Recipes',
    ]);
  });

  it('gives every dataset the display fields the UI needs', () => {
    for (const def of DATASETS) {
      expect(def.label, def.id).not.toBe('');
      expect(def.plural, def.id).toBe(def.plural.toLowerCase());
      expect(def.description, def.id).not.toBe('');
    }
  });

  it('gives every okf dataset an okfType and index.md as entry file', () => {
    expect([...OKF_DATASET_IDS]).toEqual([
      'kb',
      'rca',
      'idea',
      'task',
      'bug',
      'feature',
      'project',
    ]);
    for (const id of OKF_DATASET_IDS) {
      const def = datasetDef(id);
      expect(def.kind).toBe('okf');
      expect(def.entryFile).toBe('index.md');
      expect(def.okfType, id).toBeTruthy();
    }
    expect(DATASETS.filter((d) => d.kind === 'okf').map((d) => d.id)).toEqual([...OKF_DATASET_IDS]);
  });

  it('classifies skill and the yaml datasets', () => {
    expect(datasetDef('skill')).toMatchObject({ kind: 'skill', entryFile: 'SKILL.md' });
    expect(datasetDef('reference')).toMatchObject({ kind: 'data', entryFile: '.yaml' });
    expect(datasetDef('snippet')).toMatchObject({
      kind: 'data',
      entryFile: '.yaml',
      singular: 'snippet',
      plural: 'snippets',
    });
    expect(datasetDef('context')).toMatchObject({ kind: 'data', entryFile: '.yaml' });
    expect(datasetDef('recipe')).toMatchObject({
      kind: 'data',
      entryFile: '.yaml',
      singular: 'recipe',
      plural: 'recipes',
    });
    expect(datasetDef('skill').okfType).toBeUndefined();
  });

  it('LINKABLE_DATASETS is every dataset except context and recipe, in registry order', () => {
    expect([...LINKABLE_DATASETS]).toEqual(
      DATASET_IDS.filter((id) => id !== 'context' && id !== 'recipe'),
    );
    expect(isLinkableDatasetId('reference')).toBe(true);
    expect(isLinkableDatasetId('snippet')).toBe(true);
    expect(isLinkableDatasetId('context')).toBe(false);
    expect(isLinkableDatasetId('recipe')).toBe(false);
    expect(isLinkableDatasetId(null)).toBe(false);
  });

  it('NAV_DATASET_IDS orders the header nav and names every dataset exactly once', () => {
    expect(NAV_DATASET_IDS).toEqual([
      'kb',
      'idea',
      'feature',
      'task',
      'snippet',
      'project',
      'reference',
      'bug',
      'rca',
      'skill',
      'context',
      'recipe',
    ]);
    expect([...NAV_DATASET_IDS].sort()).toEqual([...DATASET_IDS].sort());
  });

  it('only idea, task, bug, feature and project have lifecycle states', () => {
    const withStates = DATASETS.filter((d) => d.states !== undefined).map((d) => d.id);
    expect(withStates).toEqual(['idea', 'task', 'bug', 'feature', 'project']);
  });

  it('keeps lifecycle states in lifecycle order, first = default for new entries', () => {
    const ids = (id: DatasetId): string[] => datasetDef(id).states?.map((s) => s.id) ?? [];
    expect(ids('idea')).toEqual(['pending', 'in-progress', 'complete', 'abandoned']);
    expect(ids('task')).toEqual(['pending', 'in-progress', 'complete', 'wont-do']);
    expect(ids('bug')).toEqual(['pending', 'in-progress', 'fixed', 'wont-fix']);
    expect(ids('feature')).toEqual(['pending', 'in-progress', 'complete', 'wont-do']);
    expect(ids('project')).toEqual(['pending', 'in-progress', 'complete', 'wont-do']);
  });

  it('maps states to groups per the UI spec', () => {
    const groups = (id: DatasetId): string[] => datasetDef(id).states?.map((s) => s.group) ?? [];
    expect(stateGroup('task', 'pending')).toBe('neutral');
    expect(stateGroup('task', 'in-progress')).toBe('active');
    expect(stateGroup('task', 'complete')).toBe('done');
    expect(stateGroup('bug', 'fixed')).toBe('done');
    expect(stateGroup('idea', 'abandoned')).toBe('closed');
    expect(stateGroup('task', 'wont-do')).toBe('closed');
    expect(stateGroup('bug', 'wont-fix')).toBe('closed');
    expect(groups('bug')).toEqual(['neutral', 'active', 'done', 'closed']);
    expect(groups('idea')).toEqual(['neutral', 'active', 'done', 'closed']);
  });

  it('stateGroup falls back to neutral for unknown states and datasets without lifecycle', () => {
    expect(stateGroup('bug', 'nonsense')).toBe('neutral');
    expect(stateGroup('bug', 'complete')).toBe('neutral'); // not a bug state
    expect(stateGroup('kb', 'pending')).toBe('neutral');
    expect(stateGroup('context', 'in-progress')).toBe('neutral');
  });

  it('labels states, falling back to the raw id', () => {
    expect(stateLabel('in-progress')).toBe('In progress');
    expect(stateLabel('wont-do')).toBe("Won't do");
    expect(stateLabel('wont-fix')).toBe("Won't fix");
    expect(stateLabel('mystery')).toBe('mystery');
    expect(datasetDef('bug').states?.map((s) => s.label)).toEqual([
      'Pending',
      'In progress',
      'Fixed',
      "Won't fix",
    ]);
  });

  it('looks datasets up by id', () => {
    expect(getDataset('kb')?.label).toBe('Knowledge base');
    expect(getDataset('nope')).toBeUndefined();
    expect(getDataset('constructor')).toBeUndefined();
    expect(() => datasetDef('nope' as DatasetId)).toThrow(/unknown dataset/);
  });

  it('type guards accept only real ids', () => {
    expect(isDatasetId('context')).toBe(true);
    expect(isDatasetId('nope')).toBe(false);
    expect(isDatasetId(undefined)).toBe(false);
    expect(isOkfDatasetId('kb')).toBe(true);
    expect(isOkfDatasetId('skill')).toBe(false);
    expect(isReferenceType('remote-skill')).toBe(true);
    expect(isReferenceType('remote')).toBe(false);
  });

  it('validates entry names', () => {
    for (const ok of ['a', 'a-b-1', '0', 'abc123', 'a'.repeat(NAME_MAX_LENGTH)]) {
      expect(isValidName(ok), ok).toBe(true);
    }
    const bad = ['', 'A', 'a_b', '-a', 'a-', 'a--b', 'a b', 'a/b', '..', 'a'.repeat(65), 'é'];
    for (const value of bad) expect(isValidName(value), JSON.stringify(value)).toBe(false);
    expect(NAME_MAX_LENGTH).toBe(64);
  });

  it('builds entry and doc urls', () => {
    expect(entryUrl('kb', 'x')).toBe('/kb/x');
    expect(docUrl('kb', 'x', 'concepts/y.md')).toBe('/kb/x/doc/concepts/y');
    expect(docUrl('kb', 'x', 'concepts/y')).toBe('/kb/x/doc/concepts/y');
    expect(docUrl('rca', 'x', 'index.md')).toBe('/rca/x/doc/index');
  });

  it('lists the entry relation kinds and labels both directions of each', () => {
    expect([...ENTRY_RELS]).toEqual(['child', 'related', 'depends-on']);
    expect(Object.keys(ENTRY_REL_LABELS).sort()).toEqual([...ENTRY_RELS].sort());
    expect(Object.keys(ENTRY_REL_INVERSE_LABELS).sort()).toEqual([...ENTRY_RELS].sort());
    for (const rel of ENTRY_RELS) {
      expect(ENTRY_REL_LABELS[rel], rel).not.toBe('');
      expect(ENTRY_REL_INVERSE_LABELS[rel], rel).not.toBe('');
    }
    expect(ENTRY_REL_LABELS['depends-on']).toBe('Depends on');
    expect(ENTRY_REL_INVERSE_LABELS['depends-on']).toBe('Required by');
    expect(ENTRY_REL_INVERSE_LABELS.child).toBe('Parent');
  });

  it('isEntryRel accepts only the three relation kinds', () => {
    for (const rel of ENTRY_RELS) expect(isEntryRel(rel), rel).toBe(true);
    for (const bad of ['parent', 'mentions', '', 'Child', 'constructor', null, undefined, 1]) {
      expect(isEntryRel(bad), String(bad)).toBe(false);
    }
  });
});
