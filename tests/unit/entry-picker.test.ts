import { describe, expect, it } from 'vitest';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';
import { PICKER_CAP, pickerKey, pickerRows } from '../../src/ui/pickers/picker-rows.ts';

const entry = (
  dataset: string,
  slug: string,
  title: string,
  extra: Partial<EntrySummary> = {},
): EntrySummary =>
  ({
    dataset,
    slug,
    name: slug,
    title,
    description: `About ${title}`,
    tags: [],
    lastModified: '2026-01-01T00:00:00.000Z',
    stale: false,
    url: `/${dataset}/${slug}`,
    ...extra,
  }) as EntrySummary;

describe('pickerRows', () => {
  const pool = [
    entry('task', 't1', 'Write AGENTS.md'),
    entry('kb', 'okf-format', 'OKF format', { tags: ['okf'] }),
    entry('kb', 'astro', 'Astro notes'),
    entry('skill', 'okf', 'okf skill'),
  ];

  it('orders by dataset then title, whatever the input order or modified time', () => {
    const { rows, matched } = pickerRows(pool, '');
    expect(rows.map(pickerKey)).toEqual(['kb/astro', 'kb/okf-format', 'task/t1', 'skill/okf']);
    expect(matched).toBe(4);
  });

  it('filters like the Discover pane: every term in name, title, description or tags', () => {
    expect(pickerRows(pool, 'okf').rows.map(pickerKey)).toEqual(['kb/okf-format', 'skill/okf']);
    expect(pickerRows(pool, 'okf format').rows.map(pickerKey)).toEqual(['kb/okf-format']);
    expect(pickerRows(pool, 'agents write').rows.map(pickerKey)).toEqual(['task/t1']);
    expect(pickerRows(pool, 'nothing-like-this')).toEqual({ rows: [], matched: 0 });
  });

  it('caps the rows at 200 but reports how many matched', () => {
    const many = Array.from({ length: PICKER_CAP + 25 }, (_, i) =>
      entry('kb', `e-${String(i).padStart(3, '0')}`, `Entry ${String(i).padStart(3, '0')}`),
    );
    const { rows, matched } = pickerRows(many, '');
    expect(PICKER_CAP).toBe(200);
    expect(rows).toHaveLength(200);
    expect(matched).toBe(225);
    expect(rows[0]?.slug).toBe('e-000');
    expect(pickerRows(many, '', 10).rows).toHaveLength(10);
  });

  it('does not mutate its input', () => {
    const copy = [...pool];
    pickerRows(pool, '');
    expect(pool).toEqual(copy);
  });
});

describe('pickerKey', () => {
  it('is ds/slug, the format of the exclude set', () => {
    expect(pickerKey({ dataset: 'task', slug: 'a-b' })).toBe('task/a-b');
  });
});
