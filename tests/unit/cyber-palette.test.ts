import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CYBER, type CyberColorName } from '../../src/lib/cyber-palette.ts';

const require = createRequire(import.meta.url);
const cybercoreCss = fs.readFileSync(require.resolve('cybercore-css/dist/cybercore.css'), 'utf8');
const tokensCss = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../src/styles/tokens.css'),
  'utf8',
);

/** `--cyber-cyan-500: #00f0ff;` -> { cyan500: '#00f0ff' } (first declaration wins; the file declares each once). */
function cybercoreVars(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--cyber-([a-z]+)-(\d+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const key = `${m[1]}${m[2]}`;
    if (!out.has(key)) out.set(key, (m[3] ?? '').toLowerCase());
  }
  return out;
}

/** The names in CYBER that are plain cybercore stops (`<hue><stop>`), as opposed to our extra neons. */
const CYBERCORE_KEYS = (Object.keys(CYBER) as CyberColorName[]).filter((k) => /\d$/.test(k));

/** CYBER key -> custom property in src/styles/tokens.css (the "ours" block). */
const OURS: Readonly<Record<string, string>> = {
  orange: '--cx-neon-orange',
  blueText: '--cx-neon-blue-text',
  violet: '--cx-neon-violet',
  violetText: '--cx-neon-violet-text',
  lime: '--cx-neon-lime',
  pink: '--cx-neon-pink',
  magentaText: '--cx-magenta-text',
};

describe('cyber-palette', () => {
  const css = cybercoreVars(cybercoreCss);

  it('parses the installed cybercore stylesheet', () => {
    expect(css.size).toBeGreaterThan(20);
    expect(css.get('cyan500')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(CYBERCORE_KEYS)('%s equals the installed cybercore --cyber-* value', (key) => {
    expect(css.get(key), `${key} missing from cybercore.css`).toBeDefined();
    expect(CYBER[key].toLowerCase()).toBe(css.get(key));
  });

  it('classifies every CYBER key as either a cybercore stop or one of ours', () => {
    const keys = Object.keys(CYBER).sort();
    expect(keys).toEqual([...CYBERCORE_KEYS, ...Object.keys(OURS)].sort());
  });

  it.each(Object.entries(OURS))('%s equals %s in src/styles/tokens.css', (key, prop) => {
    const m = new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(tokensCss);
    expect(m, `${prop} missing from tokens.css`).not.toBeNull();
    expect(CYBER[key as CyberColorName].toLowerCase()).toBe((m?.[1] ?? '').toLowerCase());
  });

  it('only contains 6-digit lowercase hex values', () => {
    for (const [name, hex] of Object.entries(CYBER)) {
      expect(hex, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
