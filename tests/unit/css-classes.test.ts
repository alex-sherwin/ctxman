// Guard: every `ck-*` / `cx-*` class defined in src/**/*.css is referenced by markup or code, and every such
// class referenced in markup or code is defined in a stylesheet (or sits on an explicit hook allowlist below).
// Source scan only (no DOM). Keeps the kit/app CSS free of dead rules and of classes that silently lost their rule.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../../src');
const CLASS = '(?:ck|cx)-[a-z0-9_-]+';

/**
 * Classes defined in CSS and used only through a path this scan cannot see (a script, a third party). Sorted;
 * one reason each.
 */
const DEFINED_ALLOWLIST: readonly string[] = [
  'cx-link--broken', // set on <a> by src/lib/links.ts (src/lib is not scanned)
];

/**
 * Dynamic class prefixes: the code builds the name (`ck-button--${variant}`), so every defined class with one of
 * these prefixes counts as referenced.
 */
const DYNAMIC_PREFIXES: readonly string[] = [];

/**
 * Classes referenced in markup/code that intentionally have NO CSS rule: bare BEM block hooks. Prefer removing a
 * hook from the markup when nothing needs it; add here only with a reason. Sorted.
 */
const HOOK_ALLOWLIST: readonly string[] = [
  'ck-chip__label', // kit structural hook inside Chip (styled through `.ck-chip` descendants)
  'ck-code--compact', // CodeEditor box modifier, only read by tests/devtools
  'ck-listbox__section', // kit structural hook (ListBoxSection)
  'ck-olist-wrap', // kit structural hook (OrderedList wrapper)
  'ck-olist__num', // kit structural hook (OrderedList row number)
  'ck-table__body', // kit structural hook (SSR twin of TableBody)
  'ck-table__head', // kit structural hook (SSR twin of TableHeader)
  'cx-doc-preview', // an element ID (the SSR preview node DocEditor attaches to), not a class
  'cx-filter-focus', // a sessionStorage key in FilterForm.astro, not a class
  'cx-nform', // query hook of the focus-first-invalid-field lookup in NewEntryForm.tsx; no styles
];

function walk(dir: string, exts: readonly string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Class names in selectors: the text before each `{`, comments removed. */
function definedClasses(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of walk(SRC, ['.css'])) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const chunks = css.split('{');
    for (const chunk of chunks.slice(0, -1)) {
      const selector = chunk.split(/[};]/).pop() ?? '';
      for (const m of selector.matchAll(new RegExp(`\\.(${CLASS})`, 'g'))) {
        if (m[1] !== undefined && !out.has(m[1])) out.set(m[1], path.relative(SRC, file));
      }
    }
  }
  return out;
}

function referencedClasses(): { names: Map<string, string>; dynamic: Set<string> } {
  const names = new Map<string, string>();
  const dynamic = new Set<string>();
  const files = walk(SRC, ['.ts', '.tsx', '.astro']).filter((f) => {
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    return !rel.startsWith('lib/') && !rel.startsWith('pages/api/');
  });
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(new RegExp(`(?<![\\w.$-])(${CLASS})`, 'g'))) {
      const name = m[1] ?? '';
      if (text[(m.index ?? 0) + name.length] === '$' && name.endsWith('-')) {
        dynamic.add(name); // `ck-button--${variant}`
        continue;
      }
      if (!names.has(name)) names.set(name, path.relative(SRC, file));
    }
  }
  return { names, dynamic };
}

const defined = definedClasses();
const { names: referenced, dynamic } = referencedClasses();
const prefixes = [...DYNAMIC_PREFIXES, ...dynamic];

describe('css classes', () => {
  it('the allowlists are sorted', () => {
    expect([...DEFINED_ALLOWLIST]).toEqual([...DEFINED_ALLOWLIST].sort());
    expect([...HOOK_ALLOWLIST]).toEqual([...HOOK_ALLOWLIST].sort());
  });

  it('every class defined in CSS is referenced by code or markup', () => {
    const dead = [...defined]
      .filter(([name]) => !referenced.has(name))
      .filter(([name]) => !prefixes.some((p) => name.startsWith(p)))
      .filter(([name]) => !DEFINED_ALLOWLIST.includes(name))
      .map(([name, file]) => `${name} (${file})`)
      .sort();
    expect(dead).toEqual([]);
  });

  it('every class referenced by code or markup is defined in CSS', () => {
    const missing = [...referenced]
      .filter(([name]) => !defined.has(name))
      .filter(([name]) => !HOOK_ALLOWLIST.includes(name))
      .map(([name, file]) => `${name} (${file})`)
      .sort();
    expect(missing).toEqual([]);
  });

  it('the allowlists have no entry that is unneeded', () => {
    expect(HOOK_ALLOWLIST.filter((n) => !referenced.has(n) || defined.has(n))).toEqual([]);
    expect(DEFINED_ALLOWLIST.filter((n) => !defined.has(n) || referenced.has(n))).toEqual([]);
  });
});
