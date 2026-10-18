import { describe, expect, it } from 'vitest';
import {
  alignRows,
  fenced,
  guidance,
  headingText,
  inlineCode,
  rewriteLinks,
  shQuote,
  shiftHeadings,
  stripLeadingTitle,
  truncateText,
} from '../../src/lib/inflate/markdown.ts';
import type { EntryRef } from '../../src/lib/inflate/pipeline.ts';

describe('inlineCode (re-export)', () => {
  it('wraps text', () => {
    expect(inlineCode('/a/b')).toBe('`/a/b`');
  });
});

describe('fenced', () => {
  it('uses three backticks and strips trailing newlines of the text', () => {
    expect(fenced('a\nb\n', 'sh')).toBe('```sh\na\nb\n```');
    expect(fenced('x\n\n', 'text')).toBe('```text\nx\n```');
  });

  it('uses a longer fence than any line-leading backtick run inside', () => {
    expect(fenced('before\n```\ninner\n```\nafter', 'md')).toBe(
      '````md\nbefore\n```\ninner\n```\nafter\n````',
    );
    expect(fenced('`````\nx', 'md').startsWith('``````md\n')).toBe(true);
    // up to 3 spaces of indentation still count as a fence; inline backticks do not
    expect(fenced('   ```', 'md').startsWith('````md\n')).toBe(true);
    expect(fenced('use ``` inline', 'md').startsWith('```md\n')).toBe(true);
    expect(fenced('``', 'md').startsWith('```md\n')).toBe(true);
  });
});

describe('shiftHeadings', () => {
  it('moves the shallowest heading to the base level, keeping relative depth', () => {
    expect(shiftHeadings('# A\n\ntext\n\n## B\n\n### C', 3)).toBe(
      '### A\n\ntext\n\n#### B\n\n##### C',
    );
    expect(shiftHeadings('## A\n### B', 4)).toBe('#### A\n##### B');
  });

  it('can move headings up as well', () => {
    expect(shiftHeadings('#### A\n##### B', 2)).toBe('## A\n### B');
  });

  it('clamps at level 6 (and a base above 6)', () => {
    expect(shiftHeadings('# A\n## B\n### C\n#### D', 5)).toBe(
      '##### A\n###### B\n###### C\n###### D',
    );
    expect(shiftHeadings('# A\n## B', 9)).toBe('###### A\n###### B');
  });

  it('returns the body unchanged when there are no headings', () => {
    const body = 'just text\n\n- list\n';
    expect(shiftHeadings(body, 3)).toBe(body);
    expect(shiftHeadings('', 3)).toBe('');
  });

  it('ignores "headings" inside backtick and tilde fences and inline code', () => {
    const body = [
      '## Real',
      '',
      '```md',
      '# not a heading',
      '```',
      '',
      '~~~',
      '# also not',
      '~~~',
      '',
      'a `# x` b',
    ].join('\n');
    expect(shiftHeadings(body, 4)).toBe(
      [
        '#### Real',
        '',
        '```md',
        '# not a heading',
        '```',
        '',
        '~~~',
        '# also not',
        '~~~',
        '',
        'a `# x` b',
      ].join('\n'),
    );
    // the fenced "# x" must not set the minimum
    expect(shiftHeadings('```\n# x\n```\n### Real', 2)).toBe('```\n# x\n```\n## Real');
  });

  it('only matches ATX headings: needs a space (or end), at most 3 spaces of indent', () => {
    const body = '#hashtag\n#nospace\n    # indented code\n  ## ok\n#';
    expect(shiftHeadings(body, 3)).toBe('#hashtag\n#nospace\n    # indented code\n  #### ok\n###');
  });

  it('keeps the rest of the line (closing hashes, inline code) verbatim', () => {
    expect(shiftHeadings('# Title with `code` ##', 2)).toBe('## Title with `code` ##');
  });
});

describe('stripLeadingTitle', () => {
  it('drops a matching first heading and the blank lines after it', () => {
    expect(stripLeadingTitle('# Demo\n\n\nBody here\n', 'Demo')).toBe('Body here\n');
    expect(stripLeadingTitle('\n\n## demo ##\nBody', 'DEMO')).toBe('Body');
    expect(stripLeadingTitle('#  Two   words \n\nB', 'two words')).toBe('B');
  });

  it('keeps the body when the first heading differs or the first line is not a heading', () => {
    expect(stripLeadingTitle('# Other\n\nBody', 'Demo')).toBe('# Other\n\nBody');
    expect(stripLeadingTitle('Intro\n# Demo\n', 'Demo')).toBe('Intro\n# Demo\n');
    expect(stripLeadingTitle('#Demo\nBody', 'Demo')).toBe('#Demo\nBody');
    expect(stripLeadingTitle('', 'Demo')).toBe('');
    expect(stripLeadingTitle('\n\n', 'Demo')).toBe('\n\n');
  });

  it('only the FIRST heading is removed', () => {
    expect(stripLeadingTitle('# Demo\n\n# Demo\n\ntext', 'Demo')).toBe('# Demo\n\ntext');
  });
});

describe('rewriteLinks', () => {
  const D = '/data';
  const files = new Map<string, string>([
    ['main.md', `${D}/kb/demo/main.md`],
    ['concepts/one.md', `${D}/kb/demo/concepts/one.md`],
    ['concepts/x.md', `${D}/kb/demo/concepts/x.md`],
    ['concepts/with space.md', `${D}/kb/demo/concepts/with space.md`],
    ['assets/pic.png', `${D}/kb/demo/assets/pic.png`],
  ]);
  const targets: Record<string, EntryRef | null> = {
    'kb/demo': { title: 'Demo', abs: `${D}/kb/demo/main.md` },
    'task/do-it': { title: 'do-it', abs: `${D}/task/do-it/main.md` },
    'kb/gone': null,
  };
  const rw = (body: string, fromRel = 'main.md') => rewriteLinks(body, { fromRel, files, targets });

  it('root-relative and ./relative bundle links become absolute paths', () => {
    expect(rw('[one](/concepts/one.md)')).toBe(`[one](${D}/kb/demo/concepts/one.md)`);
    expect(rw('[one](./concepts/one.md)')).toBe(`[one](${D}/kb/demo/concepts/one.md)`);
    expect(rw('[x](./one.md)', 'concepts/x.md')).toBe(`[x](${D}/kb/demo/concepts/one.md)`);
    expect(rw('[one](one.md)', 'concepts/x.md')).toBe(`[one](${D}/kb/demo/concepts/one.md)`);
  });

  it('keeps fragments', () => {
    expect(rw('[m](../main.md#demo)', 'concepts/x.md')).toBe(`[m](${D}/kb/demo/main.md#demo)`);
    expect(rw('[m](/main.md#a-b)')).toBe(`[m](${D}/kb/demo/main.md#a-b)`);
  });

  it('ctxman: links resolve through the targets map', () => {
    expect(rw('[c](ctxman:kb/demo)')).toBe(`[c](${D}/kb/demo/main.md)`);
    expect(rw('[c](ctxman:task/do-it#steps)')).toBe(`[c](${D}/task/do-it/main.md#steps)`);
  });

  it('images and reference definitions are rewritten too', () => {
    expect(rw('![pic](/assets/pic.png)')).toBe(`![pic](${D}/kb/demo/assets/pic.png)`);
    expect(rw('See [one][1].\n\n[1]: /concepts/one.md\n[2]: <ctxman:kb/demo> "T"')).toBe(
      `See [one][1].\n\n[1]: ${D}/kb/demo/concepts/one.md\n[2]: ${D}/kb/demo/main.md "T"`,
    );
  });

  it('leaves external links, anchors and mailto alone', () => {
    const body = '[a](https://example.com/x.md) [b](#anchor) [c](mailto:a@b.c) [d](//cdn.test/x)';
    expect(rw(body)).toBe(body);
  });

  it('leaves unresolved targets unchanged', () => {
    const body =
      '[a](/concepts/missing.md) [b](ctxman:kb/gone) [c](ctxman:kb/unknown) [d](../../etc/passwd) [e](ctxman:bad)';
    expect(rw(body, 'concepts/x.md')).toBe(body);
  });

  it('does not touch links inside code fences or inline code', () => {
    const body = [
      '```md',
      '[one](/concepts/one.md)',
      '```',
      '',
      '`[one](/concepts/one.md)` and [real](/concepts/one.md)',
    ].join('\n');
    expect(rw(body)).toBe(
      [
        '```md',
        '[one](/concepts/one.md)',
        '```',
        '',
        `\`[one](/concepts/one.md)\` and [real](${D}/kb/demo/concepts/one.md)`,
      ].join('\n'),
    );
    expect(rw('~~~\n[one](/concepts/one.md)\n~~~')).toBe('~~~\n[one](/concepts/one.md)\n~~~');
  });

  it('keeps link titles and rewrites several links in one line', () => {
    expect(rw('[a](/concepts/one.md "Title") and [b](ctxman:kb/demo)')).toBe(
      `[a](${D}/kb/demo/concepts/one.md "Title") and [b](${D}/kb/demo/main.md)`,
    );
  });

  it('wraps destinations containing spaces or parentheses in <…>', () => {
    expect(rw('[s](/concepts/with%20space.md)')).toBe(`[s](<${D}/kb/demo/concepts/with space.md>)`);
    expect(rw('[s](</concepts/with space.md>)')).toBe(`[s](<${D}/kb/demo/concepts/with space.md>)`);
    expect(rw('[s](/concepts/one.md#f)', 'main.md')).toBe(`[s](${D}/kb/demo/concepts/one.md#f)`);
    const parens = rewriteLinks('[p](ctxman:kb/demo)', {
      fromRel: 'main.md',
      files,
      targets: { 'kb/demo': { title: 'D', abs: '/da ta/(x)/main.md' } },
    });
    expect(parens).toBe('[p](</da ta/(x)/main.md>)');
  });

  it('ignores empty destinations', () => {
    expect(rw('[x]() [y](<>)')).toBe('[x]() [y](<>)');
  });
});

describe('shQuote', () => {
  it('leaves safe words alone', () => {
    for (const ok of [
      'abc',
      '.claude/skills',
      'a/b-c_d.e',
      'git@github.com:o/r.git',
      'https://h.test/x.git',
      'a=b,c+d%e',
    ]) {
      expect(shQuote(ok), ok).toBe(ok);
    }
  });
  it('single-quotes everything else and escapes single quotes', () => {
    expect(shQuote('a b')).toBe("'a b'");
    expect(shQuote("it's")).toBe("'it'\\''s'");
    expect(shQuote('')).toBe("''");
    expect(shQuote('$HOME')).toBe("'$HOME'");
    expect(shQuote('a;b')).toBe("'a;b'");
    expect(shQuote('~')).toBe("'~'");
  });
});

describe('guidance', () => {
  it('is empty without notes', () => {
    expect(guidance([])).toBe('');
  });

  it('single-line note', () => {
    expect(guidance([{ context: 'ctx', notes: 'Read this.\n' }])).toBe(
      '> **From context `ctx`:** Read this.',
    );
  });

  it('multi-line note: continuation lines quoted, blank lines become a bare ">"', () => {
    expect(guidance([{ context: 'c', notes: 'Open work:\n\n- one\n- two\n' }])).toBe(
      '> **From context `c`:** Open work:\n>\n> - one\n> - two',
    );
    expect(guidance([{ context: 'c', notes: '  \r\nfirst\r\n\r\nsecond  \r\n' }])).toBe(
      '> **From context `c`:** first\n>\n> second',
    );
  });

  it('two contexts are separated by a bare ">" line', () => {
    expect(
      guidance([
        { context: 'a', notes: 'A says.' },
        { context: 'b', notes: 'B says\nmore' },
      ]),
    ).toBe('> **From context `a`:** A says.\n>\n> **From context `b`:** B says\n> more');
  });
});

describe('headingText', () => {
  it('repeats # for the level (clamped 1..6) and collapses whitespace', () => {
    expect(headingText(3, 'Hello')).toBe('### Hello');
    expect(headingText(0, 'x')).toBe('# x');
    expect(headingText(9, 'x')).toBe('###### x');
    expect(headingText(2, '  a \n  b\t c ')).toBe('## a b c');
  });
});

describe('truncateText', () => {
  it('collapses whitespace and leaves short text alone', () => {
    expect(truncateText('  a \n b\t c  ', 20)).toBe('a b c');
    expect(truncateText('', 5)).toBe('');
    expect(truncateText('12345', 5)).toBe('12345');
  });

  it('cuts to max - 1 characters plus an ellipsis, dropping a trailing space', () => {
    expect(truncateText('123456', 5)).toBe('1234…');
    expect(truncateText('abc defgh', 5)).toBe('abc…');
    expect(
      truncateText('The Astro documentation source, English content. Consult it for more', 56),
    ).toBe('The Astro documentation source, English content. Consul…');
    expect(
      truncateText('The Astro documentation source, English content. Consult it for more', 56),
    ).toHaveLength(56);
  });
});

describe('alignRows', () => {
  it('pads the name column to the longest name + 2; rows without a note are the bare name', () => {
    expect(
      alignRows([
        { name: 'a.md', note: 'first' },
        { name: 'dir/' },
        { name: '  longer-name/', note: 'second' },
        { name: 'x', note: '' },
        { name: 'y', note: null },
      ]),
    ).toEqual([`a.md${' '.repeat(12)}first`, 'dir/', '  longer-name/  second', 'x', 'y']);
  });

  it('caps the column at maxWidth and always keeps two spaces after a longer name', () => {
    const long = 'n'.repeat(45);
    expect(
      alignRows(
        [
          { name: 'ab', note: 'x' },
          { name: long, note: 'y' },
        ],
        10,
      ),
    ).toEqual(['ab        x', `${long}  y`]);
    expect(
      alignRows([
        { name: 'ab', note: 'x' },
        { name: 'n'.repeat(38), note: 'y' },
      ]),
    ).toEqual([`ab${' '.repeat(38)}x`, `${'n'.repeat(38)}  y`]);
    expect(alignRows([{ name: 'n'.repeat(39), note: 'y' }])).toEqual([`${'n'.repeat(39)}  y`]);
  });

  it('handles no rows', () => {
    expect(alignRows([])).toEqual([]);
  });
});
