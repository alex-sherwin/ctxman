import { describe, expect, it } from 'vitest';
import {
  alignRows,
  dropEmptySections,
  fenced,
  firstHeadingText,
  guidance,
  headingText,
  inlineCode,
  nestHeadings,
  rewriteLinks,
  shQuote,
  shiftHeadings,
  stripLeadingTitle,
  truncateText,
} from '../../src/lib/inflate/markdown.ts';
import type { UnresolvedReason } from '../../src/lib/inflate/markdown.ts';
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

describe('dropEmptySections (ROUND3 §H.2)', () => {
  it('drops a heading followed by the end of the text or by a heading of the same or a higher level', () => {
    expect(dropEmptySections('# Do it\n')).toBe('');
    expect(dropEmptySections('text\n\n## Empty\n\n## Next\n\nbody\n')).toBe(
      'text\n\n## Next\n\nbody\n',
    );
    expect(dropEmptySections('### Deep\n\n# Top\n\nbody')).toBe('# Top\n\nbody');
    expect(dropEmptySections('text\n\n## Trailing\n\n\n')).toBe('text\n');
  });

  it('keeps a heading that has content or a deeper heading below it', () => {
    const body = '# A\n\n## B\n\ntext\n\n## C\n\n### D\n\nmore\n';
    expect(dropEmptySections(body)).toBe(body);
    expect(dropEmptySections('## A\n- item')).toBe('## A\n- item');
  });

  it('repeats until stable: a section that only held empty subsections goes too', () => {
    expect(dropEmptySections('## A\n### B\n#### C\n## D\n\nkeep')).toBe('## D\n\nkeep');
    expect(dropEmptySections('# T\n\n## Notes\n\n## Links\n\n### Inner\n')).toBe('');
  });

  it('never looks inside code: fenced "headings" stay, and a fence counts as content', () => {
    const fenced = '## Example\n\n```md\n# Heading in code\n```\n';
    expect(dropEmptySections(fenced)).toBe(fenced);
    expect(dropEmptySections('```\n## Not a heading\n```\n')).toBe('```\n## Not a heading\n```\n');
    expect(dropEmptySections('## A\n\n`code`\n\n## B\n')).toBe('## A\n\n`code`\n');
  });

  it('only matches ATX headings; text without any is returned unchanged', () => {
    expect(dropEmptySections('#hashtag\n\nplain\n')).toBe('#hashtag\n\nplain\n');
    expect(dropEmptySections('')).toBe('');
    expect(dropEmptySections('Title\n=====\n')).toBe('Title\n=====\n');
  });
});

describe('nestHeadings (ROUND3 §H.4)', () => {
  it('shifts a block whose shallowest heading is above the base so that heading lands on the base', () => {
    expect(nestHeadings('# Big\n\ntext\n\n## Sub', 3)).toBe('### Big\n\ntext\n\n#### Sub');
    expect(nestHeadings('## Rules\n- a', 3)).toBe('### Rules\n- a');
  });

  it('keeps a block whose headings are already at the base or deeper, or that has none', () => {
    expect(nestHeadings('## Rules\n\n### Sub', 2)).toBe('## Rules\n\n### Sub');
    expect(nestHeadings('#### Deep\n', 3)).toBe('#### Deep\n');
    expect(nestHeadings('just text', 3)).toBe('just text');
  });

  it('ignores headings in code when looking for the shallowest level', () => {
    expect(nestHeadings('```\n# code\n```\n### Real', 3)).toBe('```\n# code\n```\n### Real');
  });
});

describe('firstHeadingText', () => {
  it('is the text of the first ATX heading of any level, closing hashes and extra spaces dropped', () => {
    expect(firstHeadingText('intro\n\n## Rules  of   play ##\n\n# Later')).toBe('Rules of play');
    expect(firstHeadingText('### With `code`')).toBe('With `code`');
  });

  it('is null without a heading; headings in code and empty headings do not count', () => {
    expect(firstHeadingText('just text')).toBeNull();
    expect(firstHeadingText('```\n# no\n```\n#\n#hash')).toBeNull();
    expect(firstHeadingText('')).toBeNull();
    expect(firstHeadingText('#\n\n## Real')).toBe('Real');
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
    ['index.md', `${D}/kb/demo/index.md`],
    ['concepts/one.md', `${D}/kb/demo/concepts/one.md`],
    ['concepts/x.md', `${D}/kb/demo/concepts/x.md`],
    ['concepts/with space.md', `${D}/kb/demo/concepts/with space.md`],
    ['assets/pic.png', `${D}/kb/demo/assets/pic.png`],
  ]);
  const targets: Record<string, EntryRef | null> = {
    'kb/demo': { title: 'Demo', abs: `${D}/kb/demo/index.md` },
    'task/do-it': { title: 'do-it', abs: `${D}/task/do-it/index.md` },
    'kb/gone': null,
  };
  const rw = (body: string, fromRel = 'index.md') =>
    rewriteLinks(body, { fromRel, files, targets });

  it('root-relative and ./relative bundle links become absolute paths', () => {
    expect(rw('[one](/concepts/one.md)')).toBe(`[one](${D}/kb/demo/concepts/one.md)`);
    expect(rw('[one](./concepts/one.md)')).toBe(`[one](${D}/kb/demo/concepts/one.md)`);
    expect(rw('[x](./one.md)', 'concepts/x.md')).toBe(`[x](${D}/kb/demo/concepts/one.md)`);
    expect(rw('[one](one.md)', 'concepts/x.md')).toBe(`[one](${D}/kb/demo/concepts/one.md)`);
  });

  it('keeps fragments', () => {
    expect(rw('[m](../index.md#demo)', 'concepts/x.md')).toBe(`[m](${D}/kb/demo/index.md#demo)`);
    expect(rw('[m](/index.md#a-b)')).toBe(`[m](${D}/kb/demo/index.md#a-b)`);
  });

  it('ctxman: links resolve through the targets map', () => {
    expect(rw('[c](ctxman:kb/demo)')).toBe(`[c](${D}/kb/demo/index.md)`);
    expect(rw('[c](ctxman:task/do-it#steps)')).toBe(`[c](${D}/task/do-it/index.md#steps)`);
  });

  it('images and reference definitions are rewritten too', () => {
    expect(rw('![pic](/assets/pic.png)')).toBe(`![pic](${D}/kb/demo/assets/pic.png)`);
    expect(rw('See [one][1].\n\n[1]: /concepts/one.md\n[2]: <ctxman:kb/demo> "T"')).toBe(
      `See [one][1].\n\n[1]: ${D}/kb/demo/concepts/one.md\n[2]: ${D}/kb/demo/index.md "T"`,
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
      `[a](${D}/kb/demo/concepts/one.md "Title") and [b](${D}/kb/demo/index.md)`,
    );
  });

  it('wraps destinations containing spaces or parentheses in <…>', () => {
    expect(rw('[s](/concepts/with%20space.md)')).toBe(`[s](<${D}/kb/demo/concepts/with space.md>)`);
    expect(rw('[s](</concepts/with space.md>)')).toBe(`[s](<${D}/kb/demo/concepts/with space.md>)`);
    expect(rw('[s](/concepts/one.md#f)', 'index.md')).toBe(`[s](${D}/kb/demo/concepts/one.md#f)`);
    const parens = rewriteLinks('[p](ctxman:kb/demo)', {
      fromRel: 'index.md',
      files,
      targets: { 'kb/demo': { title: 'D', abs: '/da ta/(x)/index.md' } },
    });
    expect(parens).toBe('[p](</da ta/(x)/index.md>)');
  });

  it('ignores empty destinations', () => {
    expect(rw('[x]() [y](<>)')).toBe('[x]() [y](<>)');
  });

  describe('onUnresolved (ROUND3 §H.5)', () => {
    const collect = (body: string, fromRel = 'index.md'): [string, UnresolvedReason][] => {
      const seen: [string, UnresolvedReason][] = [];
      rewriteLinks(body, {
        fromRel,
        files,
        targets,
        onUnresolved: (destination, reason) => seen.push([destination, reason]),
      });
      return seen;
    };

    it('reports a missing entry, a missing bundle file, an escaping path and a malformed ctxman: link', () => {
      expect(
        collect(
          '[a](/concepts/missing.md) [b](ctxman:kb/gone) [c](../../etc/passwd) [d](ctxman:bad) [e](ctxman:nope/x)',
          'concepts/x.md',
        ),
      ).toEqual([
        ['/concepts/missing.md', 'no-file'],
        ['ctxman:kb/gone', 'no-entry'],
        ['../../etc/passwd', 'escapes'],
        ['ctxman:bad', 'malformed'],
        ['ctxman:nope/x', 'malformed'],
      ]);
    });

    it('reports in document order, with the destination as written (fragment kept, <> removed)', () => {
      expect(
        collect('[a](ctxman:kb/gone#x) text [b](</concepts/nope.md#f>)\n\n[1]: ./nope.md'),
      ).toEqual([
        ['ctxman:kb/gone#x', 'no-entry'],
        ['/concepts/nope.md#f', 'no-file'],
        ['./nope.md', 'no-file'],
      ]);
    });

    it('stays silent for resolved links, external links, anchors, empty destinations and code', () => {
      expect(
        collect(
          [
            '[a](/concepts/one.md) [b](ctxman:kb/demo) [c](https://x.test/y.md) [d](#top) [e]() [f](mailto:a@b.c)',
            '`[g](/nope.md)`',
            '```',
            '[h](ctxman:kb/gone)',
            '```',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    it('does not change the output: unresolved destinations stay as written', () => {
      const body = '[a](/concepts/missing.md) [b](ctxman:kb/gone)';
      expect(rw(body)).toBe(body);
    });

    it('a ctxman: key that was never looked up is left alone without a report', () => {
      expect(collect('[c](ctxman:kb/unknown)')).toEqual([]);
    });
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
