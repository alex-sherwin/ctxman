import { describe, expect, it } from 'vitest';
import { tocEntries } from '../../src/lib/doc-toc.ts';

const h = (depth: number, text: string) => ({
  depth,
  id: text.toLowerCase().replaceAll(' ', '-'),
  text,
});

describe('tocEntries', () => {
  it('drops a lone h1 title at the top and indents relative to the shallowest heading left', () => {
    expect(
      tocEntries([h(1, 'Title'), h(2, 'Goal'), h(3, 'Detail'), h(2, 'Steps'), h(4, 'Deep')]),
    ).toEqual([
      { id: 'goal', text: 'Goal', level: 0 },
      { id: 'detail', text: 'Detail', level: 1 },
      { id: 'steps', text: 'Steps', level: 0 },
      { id: 'deep', text: 'Deep', level: 2 },
    ]);
  });

  it('keeps h1s when there are several (or the first heading is not one) and leaves out h5 / h6', () => {
    expect(
      tocEntries([h(1, 'A'), h(2, 'A1'), h(1, 'B'), h(5, 'Small')]).map((e) => e.level),
    ).toEqual([0, 1, 0]);
    expect(tocEntries([h(2, 'Intro'), h(1, 'Late title')]).map((e) => e.text)).toEqual([
      'Intro',
      'Late title',
    ]);
  });

  it('is empty below two entries', () => {
    expect(tocEntries([])).toEqual([]);
    expect(tocEntries([h(1, 'Title'), h(2, 'Only')])).toEqual([]);
    expect(tocEntries([h(1, 'Title'), h(6, 'x'), h(5, 'y')])).toEqual([]);
  });
});
