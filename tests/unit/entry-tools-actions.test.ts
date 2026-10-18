import { describe, expect, it } from 'vitest';
import { LOCK_TITLE, readTrigger, syncActions } from '../../src/ui/entry/entry-actions.ts';

/** The slice of an element the module touches: attributes, `disabled`, `dataset`, `closest`, `querySelector`. */
class FakeEl {
  disabled: boolean;
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  parent: FakeEl | null = null;
  text: string | null = null;
  constructor(attrs: Record<string, string> = {}, disabled = false) {
    this.disabled = disabled;
    for (const [k, v] of Object.entries(attrs)) {
      this.attrs.set(k, v);
      if (k.startsWith('data-')) {
        this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
      }
    }
  }
  hasAttribute = (k: string) => this.attrs.has(k);
  getAttribute = (k: string) => this.attrs.get(k) ?? null;
  setAttribute = (k: string, v: string) => void this.attrs.set(k, v);
  removeAttribute = (k: string) => void this.attrs.delete(k);
  closest = (selector: string): FakeEl | null => {
    // only `[data-key]` is used
    const attr = selector.slice(1, -1);
    if (this.attrs.has(attr)) return this;
    let el = this.parent;
    while (el !== null) {
      if (el.attrs.has(attr)) return el;
      el = el.parent;
    }
    return null;
  };
  querySelector = (): { textContent: string | null } | null =>
    this.text === null ? null : { textContent: this.text };
}

const root = (...els: FakeEl[]) => ({ querySelectorAll: () => els }) as unknown as ParentNode;
const as = (el: FakeEl) => el as unknown as HTMLElement;

describe('syncActions', () => {
  it('enables the SSR-disabled action buttons on mount (not editing)', () => {
    const button = new FakeEl({ 'data-entry-action': 'frontmatter' }, true);
    syncActions(false, root(button));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('title')).toBeNull();
  });

  it('locks buttons and state selects while editing, with the reason as title', () => {
    const button = new FakeEl({ 'data-entry-action': 'add-child', title: 'Add a child' });
    const select = new FakeEl({ 'data-state-select': '' });
    syncActions(true, root(button, select));
    expect(button.disabled).toBe(true);
    expect(select.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe(LOCK_TITLE);
    expect(select.getAttribute('title')).toBe(LOCK_TITLE);
  });

  it('unlocking restores the original title (or none) and enables only what it locked', () => {
    const button = new FakeEl({ 'data-entry-action': 'add-child', title: 'Add a child' });
    const select = new FakeEl({ 'data-state-select': '' });
    syncActions(true, root(button, select));
    syncActions(false, root(button, select));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('title')).toBe('Add a child');
    expect(select.disabled).toBe(false);
    expect(select.getAttribute('title')).toBeNull();
    expect(button.hasAttribute('data-edit-locked')).toBe(false);
  });

  it('a state select disabled by its own request is left alone, locked or not', () => {
    const busy = new FakeEl({ 'data-state-select': '' }, true);
    syncActions(true, root(busy));
    expect(busy.hasAttribute('data-edit-locked')).toBe(false);
    expect(busy.getAttribute('title')).toBeNull();
    syncActions(false, root(busy));
    expect(busy.disabled).toBe(true);
  });

  it('locking twice keeps the first original title', () => {
    const button = new FakeEl({ 'data-entry-action': 'frontmatter', title: 'Edit details' });
    syncActions(true, root(button));
    syncActions(true, root(button));
    syncActions(false, root(button));
    expect(button.getAttribute('title')).toBe('Edit details');
  });

  it('SSR buttons that mount while the editor is already open stay disabled until it closes', () => {
    const button = new FakeEl({ 'data-entry-action': 'frontmatter' }, true);
    syncActions(true, root(button));
    expect(button.disabled).toBe(true);
    syncActions(false, root(button));
    expect(button.disabled).toBe(false);
  });
});

describe('readTrigger', () => {
  it('reads the action and its data attributes', () => {
    const button = new FakeEl({
      'data-entry-action': 'new-concept',
      'data-path': 'concepts/x.md',
    });
    expect(readTrigger(as(button), new Map())).toMatchObject({
      action: 'new-concept',
      path: 'concepts/x.md',
    });
  });

  it('key and rel come from the button, else from the row it sits in', () => {
    const row = new FakeEl({ 'data-key': 'task/a', 'data-rel': 'related' });
    row.text = 'Row title';
    const button = new FakeEl({ 'data-entry-action': 'remove-relation' });
    button.parent = row;
    expect(readTrigger(as(button), new Map())).toMatchObject({
      key: 'task/a',
      rel: 'related',
      title: 'Row title',
    });
    const own = new FakeEl({ 'data-entry-action': 'remove-child', 'data-key': 'bug/b' });
    own.parent = row;
    expect(readTrigger(as(own), new Map()).key).toBe('bug/b');
  });

  it('the title is data-title, else the known title of the key, else the row text', () => {
    const row = new FakeEl({ 'data-key': 'task/a' });
    row.text = 'Row text';
    const button = new FakeEl({ 'data-entry-action': 'remove-child' });
    button.parent = row;
    expect(readTrigger(as(button), new Map([['task/a', 'Known']])).title).toBe('Known');
    const titled = new FakeEl({
      'data-entry-action': 'remove-child',
      'data-key': 'task/a',
      'data-title': 'Explicit',
    });
    expect(readTrigger(as(titled), new Map([['task/a', 'Known']])).title).toBe('Explicit');
    expect(readTrigger(as(button), new Map()).title).toBe('Row text');
  });
});
