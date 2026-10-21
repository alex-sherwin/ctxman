// markdown -> Jira wiki markup (src/lib/jira-markup.ts): every mdast / GFM node, nesting, and each escaping rule
// both ways (escaped where Jira Server or Cloud would read markup, untouched where neither would). PURE: no fs.
import { describe, expect, it } from 'vitest';
import { jiraCodeLanguage, markdownToJira as jira } from '../../src/lib/jira-markup.ts';

const r = String.raw;
/** The zero-width space used where Jira has no backslash escape. */
const Z = '\u200B';
const NBSP = '\u00A0';

describe('markdownToJira: the document', () => {
  it('turns empty and whitespace-only input into an empty string', () => {
    expect(jira('')).toBe('');
    expect(jira('   \n\n\t\n')).toBe('');
    expect(jira('<!-- only a comment -->')).toBe('');
  });

  it('drops a leading frontmatter block (an okf document), also with a BOM and CRLF line endings', () => {
    expect(jira('---\ntitle: x\ntags: [a]\n---\n\n# Body\n')).toBe('h1. Body');
    expect(jira('\uFEFF---\r\ntitle: x\r\n---\r\nBody\r\nline two\r\n')).toBe('Body line two');
    expect(jira('---\n---\ntext')).toBe('text');
  });

  it('keeps a `---` that opens no closed frontmatter block (a rule) and frontmatter-like text later on', () => {
    expect(jira('---\nno closing\n\ntext')).toBe('----\n\nno closing\n\ntext');
    expect(jira('text\n\n---\na: 1\n---')).toBe('text\n\n----\n\nh2. a: 1');
  });

  it('normalizes CRLF and lone CR line endings', () => {
    expect(jira('a\r\nb\r\n\r\nc\rd')).toBe('a b\n\nc d');
  });

  it('separates blocks with one blank line and ends without a trailing newline', () => {
    expect(jira('# T\n\n\n\npara\n\n\n- a\n')).toBe('h1. T\n\npara\n\n* a');
  });

  it('escapes long runs of markers in linear time (each took 7 to 20 s when a check looked ahead per character)', () => {
    const lines: [string, string][] = [
      // (a later `!` or `??` could close all but the last one)
      ['x!'.repeat(150000), r`x\!`.repeat(149999) + 'x!'],
      [' ??x'.repeat(30000), r`\??x `.repeat(29999) + '??x'],
      // (no `*` can close: each one touches the letter after it)
      [r`(\*a `.repeat(30000), '(*a '.repeat(29999) + '(*a'],
      // (a space after every `\\` but the last: another `\\` follows in the same word)
      [`| h |\n|---|\n| ${'a<br>'.repeat(20000)} |`, `||h||\n|${r`a\\ `.repeat(19998)}${r`a\\a`}|`],
    ];
    for (const [md, expected] of lines) {
      const start = performance.now();
      const out = jira(md);
      // (about 0.1 s each, also under load far below the bound)
      expect(performance.now() - start, md.slice(0, 12)).toBeLessThan(3000);
      expect(out).toBe(expected);
    }
  });
});

describe('markdownToJira: headings, paragraphs, breaks and rules', () => {
  it('writes ATX and setext headings as hN.', () => {
    expect(jira('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six')).toBe(
      'h1. One\n\nh2. Two\n\nh3. Three\n\nh4. Four\n\nh5. Five\n\nh6. Six',
    );
    expect(jira('Setext\n======\n\nTwo\n---')).toBe('h1. Setext\n\nh2. Two');
  });

  it('keeps effects and code in headings, puts a hard break as a space and drops an empty heading', () => {
    expect(jira('## A *b* `c` **d**')).toBe('h2. A _b_ {{c}} *d*');
    expect(jira('## one<br>two')).toBe('h2. one two');
    // (an ATX heading is one line: a trailing backslash stays text)
    expect(jira('## one\\\ntwo')).toBe('h2. one\\\n\ntwo');
    expect(jira('#\n\n##   \n\ntext')).toBe('text');
  });

  it('escapes what would be a list or a table at the start of heading text', () => {
    expect(jira('## \\* star')).toBe(r`h2. \* star`);
  });

  it('joins soft line breaks with a space (hard-wrapped docs) and turns tabs into spaces', () => {
    expect(jira('one\ntwo\n  three')).toBe('one two three');
    expect(jira('tab\there')).toBe('tab here');
  });

  it('writes a hard break (two spaces, backslash, <br>) as a newline and drops empty lines', () => {
    expect(jira('one  \ntwo\\\nthree<br>four')).toBe('one\ntwo\nthree\nfour');
    expect(jira('a<br><br>b')).toBe('a\nb');
    expect(jira('<br>lead')).toBe('lead');
    expect(jira('a `x` <br>b')).toBe('a {{x}}\nb');
  });

  it('writes a thematic break as ----', () => {
    expect(jira('a\n\n***\n\nb\n\n- - -\n\n___')).toBe('a\n\n----\n\nb\n\n----\n\n----');
  });

  it('keeps non-ASCII text as is', () => {
    expect(jira('Unicode: 日本語 😀 café ñ')).toBe('Unicode: 日本語 😀 café ñ');
    expect(jira('&nbsp;&nbsp;indented')).toBe(`${NBSP}${NBSP}indented`);
  });
});

describe('markdownToJira: text effects', () => {
  it('maps strong, emphasis and strikethrough (double and single tilde)', () => {
    expect(jira('a **b** c *d* e __f__ g _h_ i ~~j~~ k ~l~')).toBe(
      'a *b* c _d_ e *f* g _h_ i -j- k -l-',
    );
  });

  it('nests different effects and flattens the same effect nested in itself', () => {
    expect(jira('*a **b** c*')).toBe('_a *b* c_');
    expect(jira('**a *b* c**')).toBe('*a _b_ c*');
    expect(jira('***x***')).toBe('_*x*_');
    expect(jira('~~**x** y~~')).toBe('-*x* y-');
    expect(jira('**a __b__ c**')).toBe('*a b c*');
  });

  it('uses the {*} form when a marker touches a letter, digit or any non-ASCII character', () => {
    expect(jira('foo**bar**baz')).toBe('foo{*}bar{*}baz');
    expect(jira('**y**z and x**y**')).toBe('{*}y{*}z and x{*}y{*}');
    expect(jira('un*believ*able and a~~b~~c')).toBe('un{_}believ{_}able and a{-}b{-}c');
    expect(jira('これは**重要**です')).toBe('これは{*}重要{*}です');
    expect(jira('**Done**✅')).toBe('{*}Done{*}✅');
  });

  it('keeps the plain form next to punctuation, spaces and a no-break space', () => {
    expect(jira('(**a**), "*b*" and **c**.')).toBe('(*a*), "_b_" and *c*.');
    expect(jira(`x&nbsp;**y**&nbsp;z`)).toBe(`x${NBSP}*y*${NBSP}z`);
  });

  it('moves whitespace at the edges of an effect outside its markers', () => {
    expect(jira('a **<!-- c --> b <!-- d -->** c')).toBe('a  *b*  c');
    expect(jira('a **<!-- only -->** b')).toBe('a  b');
  });

  it('closes and reopens an effect around a hard break', () => {
    expect(jira('**a  \nb**')).toBe('*a*\n*b*');
    expect(jira('*one\\\ntwo three*')).toBe('_one_\n_two three_');
  });

  it('keeps escapes inside an effect working in Cloud, which re-reads effect text without its escapes', () => {
    // (a zero-width space after `{`, `[` or an emoticon `(`, before a marker that could open or an emoticon face)
    expect(jira('**Done (x) and (/)**')).toBe(`*Done \\(${Z}x) and \\(${Z}/)*`);
    expect(jira('**See {panel} for details** and **{code}**')).toBe(
      `*See \\{${Z}panel\\} for details* and *\\{${Z}code}*`,
    );
    expect(jira('**Note: use [~user] here**')).toBe(`*Note: use \\[${Z}~user] here*`);
    expect(jira('**a +b+ c** and **a \\^x\\^ and \\~y\\~ z**')).toBe(
      `*a ${Z}\\+b+ c* and *a ${Z}\\^x^ and ${Z}\\~y~ z*`,
    );
    expect(jira('**ok :) (y)** and **!img! and ??cite?? done**')).toBe(
      `*ok :${Z}\\) \\(${Z}y)* and *${Z}\\!img! and ${Z}\\??cite?? done*`,
    );
    // an inner effect of the marker's kind is a closer too
    expect(jira('_a \\*b **c**_')).toBe(`_a ${Z}\\*b *c*_`);
  });

  it('starts effect text that Cloud would read as a line start (list, heading, quote, rule) with a zero-width space', () => {
    expect(
      jira('**\\- x** and **\\* x** and **\\# x** and **h1\\. x** and **bq\\.** and ***h2\\. x***'),
    ).toBe(
      `*${Z}- x* and *${Z}\\* x* and *${Z}# x* and *${Z}h1. x* and *${Z}bq.* and _*${Z}h2. x*_`,
    );
    expect(jira('**\\---- x**')).toBe(`*${Z}\\-${Z}\\--- x*`);
  });

  it('drops an effect around a literal [...] that holds | or ^ (Cloud reads it as a link or attachment there)', () => {
    expect(jira('**see [a|b] here** and *x [a^b] y*')).toBe(
      `see \\[${Z}a|b] here and x \\[${Z}a^b] y`,
    );
    expect(jira('_a **[x|y]** b_ and **[a] |b|**')).toBe(`a \\[${Z}x|y] b and *\\[${Z}a] |b|*`);
  });

  it('puts no zero-width space next to our {{ or }}, and drops the effect where one would be needed there', () => {
    // (Cloud reads no code after a letter-like character or before one, and a ZWSP counts as one)
    expect(jira('**[`opt`]**')).toBe(r`*\[{{opt}}]*`);
    expect(jira('**`a`\\*b\\*** and ~~`x`!a `y`!~~ and **{`x`}**')).toBe(
      r`{{a}}\*b\* and {{x}}\!a {{y}}! and \{{{x}}}`,
    );
  });

  it('adds no zero-width space when the marker cannot pair up inside the effect', () => {
    expect(jira('**\\*x** and ~~x -y~~ and **a \\* b**')).toBe(r`*\*x* and -x \-y- and *a \* b*`);
  });

  it('drops the {*} form of an effect whose text holds its marker (Cloud closes it there) and keeps the text', () => {
    expect(jira('x~~kebab-case~~y')).toBe('xkebab-casey');
    expect(jira('foo**a \\* b** and x**a\\*b**y')).toBe(r`fooa \* b and xa*by`);
    expect(jira('x**a [**b**](https://x.y) c**y')).toBe('xa [*b*|https://x.y] cy');
    // other markers inside are fine
    expect(jira('x**a_b-c**y')).toBe('x{*}a_b-c{*}y');
  });

  it('keeps an effect around inline code, links and images', () => {
    expect(jira('**`x`**')).toBe('*{{x}}*');
    expect(jira('**[a](https://x.y)**')).toBe('*[a|https://x.y]*');
    expect(jira('_![i](https://x.y/i.png)_')).toBe('_!https://x.y/i.png|alt=i!_');
  });
});

describe('markdownToJira: inline code', () => {
  it('writes {{code}} and keeps adjacent code spans apart', () => {
    expect(jira('use `pnpm run dev` now')).toBe('use {{pnpm run dev}} now');
    expect(jira('`a` `b`')).toBe('{{a}} {{b}}');
    expect(jira('`` a ` b ``')).toBe('{{a ` b}}');
  });

  it('takes a touching word into the code span (Jira ignores {{x}}s)', () => {
    expect(jira('`Foo`s and re`load` and é`x`')).toBe('{{Foos}} and {{reload}} and {{éx}}');
    expect(jira('`x`-y and `x`.')).toBe('{{x}}-y and {{x}}.');
    expect(jira('a`b`c`d`e')).toBe('{{abc}}{{de}}');
  });

  it('moves spaces inside the backticks outside and drops a whitespace-only span', () => {
    expect(jira('x `  b  ` y')).toBe('x  {{b}}  y');
    expect(jira('x ` ` y')).toBe('x   y');
  });

  it('escapes braces and brackets inside code', () => {
    expect(jira('`{{x}}` and `a}` and `[link]` and `{code}`')).toBe(
      r`{{\{\{x\}\}}} and {{a\}}} and {{\[link]}} and {{\{code\}}}`,
    );
  });

  it('escapes effects inside code only where Jira Server would render them', () => {
    expect(jira('`a*b*c` and `*x*` and `2 * 3` and `snake_case`')).toBe(
      r`{{a*b*c}} and {{\*x*}} and {{2 * 3}} and {{snake_case}}`,
    );
    expect(jira('`a -- b` and `f(x)` and `:)`')).toBe(r`{{a \-- b}} and {{f\(x)}} and {{:\)}}`);
  });

  it('keeps a backslash in code apart from what it would escape or break', () => {
    expect(jira('`C:\\dir` and `\\d+` and `\\(` and `\\\\n` and `x\\`')).toBe(
      `{{C:\\dir}} and {{\\d+}} and {{\\${Z}(}} and {{\\${Z}\\n}} and {{x\\${Z}}}`,
    );
  });

  it('keeps code inside an effect whole in Cloud (a zero-width space after `{` and between `}` and `}`)', () => {
    expect(jira('**`{dataset}`**')).toBe(`*{{\\{${Z}dataset\\}${Z}}}*`);
    expect(jira('*`{a}/{b}`* and **`a}} b`** and **`{}`**')).toBe(
      `_{{\\{${Z}a\\}/\\{${Z}b\\}${Z}}}_ and *{{a\\}${Z}\\} b}}* and *{{\\{${Z}\\}${Z}}}*`,
    );
  });

  it('takes a backslash that touches the code into it (`\\{{` would escape the brace)', () => {
    expect(jira('C:\\\\`dir` and x\\\\\\\\`y`')).toBe(`C:{{\\dir}} and {{x\\${Z}\\y}}`);
  });

  it('does not escape a pipe in code outside a table', () => {
    expect(jira('`a|b` and `GET|PUT`')).toBe('{{a|b}} and {{GET|PUT}}');
  });
});

describe('markdownToJira: escaping text', () => {
  it('always escapes { and [ (macros, monospace, links, mentions), never } or ]', () => {
    expect(jira('a {curly} and {{double}} and [square] and [~user] and {code} b')).toBe(
      r`a \{curly} and \{\{double}} and \[square] and \[~user] and \{code} b`,
    );
    expect(jira('a ] b } c')).toBe('a ] b } c');
  });

  it('escapes the closing brace of {quote} and {panel} text (Cloud finds their closer without reading escapes)', () => {
    expect(jira('use {quote} and {Panel} but {quotes} and {quote:x}')).toBe(
      r`use \{quote\} and \{Panel\} but \{quotes} and \{quote:x}`,
    );
  });

  it('escapes effect markers that could open and close an effect', () => {
    expect(jira(r`\*x\* \_y\_ \-z\- \+w\+ \^v\^ \~u\~`)).toBe(r`\*x* \_y_ \-z- \+w+ \^v^ \~u~`);
    expect(jira('a ??cite?? b')).toBe(r`a \??cite?? b`);
    expect(jira('use -v or --verbose')).toBe(r`use \-v or --verbose`);
    expect(jira('~/a and ~/b')).toBe(r`\~/a and ~/b`);
  });

  it('leaves markers alone where they cannot open or close', () => {
    expect(
      jira('snake_case_name, 2 \\* 3 \\* 4, a - b, a-b-c, x+y+z, C++, x^2, What?? Really??'),
    ).toBe('snake_case_name, 2 * 3 * 4, a - b, a-b-c, x+y+z, C++, x^2, What?? Really??');
    expect(jira('use -v here and -x there')).toBe('use -v here and -x there');
  });

  it('escapes a marker inside an effect of the same kind that would close it early', () => {
    expect(jira('**2 \\* 3**')).toBe(r`*2 \* 3*`);
    expect(jira('*2 \\* 3*')).toBe('_2 * 3_');
    expect(jira('**a\\*b**')).toBe('*a*b*');
    expect(jira('**\\*x**')).toBe(r`*\*x*`);
  });

  it('escapes ! only before a possible image', () => {
    expect(jira('!important and !this!')).toBe(r`\!important and \!this!`);
    expect(jira('Hello! World! Wow!!')).toBe('Hello! World! Wow!!');
    expect(jira('a != b and c != d')).toBe(r`a \!= b and c != d`);
  });

  it('escapes `--` and `---` between spaces (Jira dashes), not inside words or longer runs', () => {
    expect(jira('a -- b and c --- d')).toBe(r`a \-- b and c \--- d`);
    expect(jira('-- start and end --')).toBe(r`\-- start and end \--`);
    expect(jira('a---b\n\n--flag\n\nx--y\n\nx--')).toBe('a---b\n\n--flag\n\nx--y\n\nx--');
    // Jira Server strikes "-flag and x-" here (a marker followed by a marker still opens)
    expect(jira('--flag and x--')).toBe(r`\-\-flag and x--`);
    expect(jira('a ---- b')).toBe(r`a \-\--- b`);
  });

  it('escapes line-start list, table, rule, heading and quote markers', () => {
    expect(jira('\\* a\n\n\\# b\n\n\\- c\n\n\\| d\n\n\\---- e\n\n\\-- f')).toBe(
      r`\* a

\# b

\- c

\| d

\-\--- e

\-- f`,
    );
    expect(jira('h1. not a heading\n\nH3. nor this\n\nbq. not a quote')).toBe(
      `${Z}h1. not a heading\n\n${Z}H3. nor this\n\n${Z}bq. not a quote`,
    );
  });

  it('leaves line-start characters alone when they start no Jira block', () => {
    expect(jira('\\#1 priority\n\n\\*bold\n\n\\-1 point\n\nh7. x\n\nbq x')).toBe(
      '#1 priority\n\n*bold\n\n-1 point\n\nh7. x\n\nbq x',
    );
  });

  it('applies line-start rules after a hard break too', () => {
    expect(jira('a\\\n\\* b\\\n\\| c')).toBe('a\n\\* b\n\\| c');
  });

  it('does not escape a pipe or # in the middle of a line', () => {
    expect(jira('a | b and a #1')).toBe('a | b and a #1');
  });

  it('escapes emoticons so they stay text', () => {
    expect(
      jira(
        '(y) (n) (i) (/) (x) (!) (+) (-) (?) (on) (off) (\\*) (\\*r) (\\*g) (\\*b) (\\*y) (flag) (flagoff)',
      ),
    ).toBe(
      r`\(y) \(n) \(i) \(/) \(x) \(!) \(+) \(-) \(?) \(on) \(off) \(*) \(*r) \(*g) \(*b) \(*y) \(flag) \(flagoff)`,
    );
    expect(jira(':) :( ;) :-) :-( ;-) :-P :-p :-D')).toBe(
      r`:\) :\( ;\) :\-) :\-( ;\-) :\-P :\-p :\-D`,
    );
    expect(jira(':P :p :D. a:D')).toBe(`:${Z}P :${Z}p :${Z}D. a:${Z}D`);
    // (Cloud takes `:P` as an emoticon before anything but an ASCII letter or digit)
    expect(jira('x :Pé and :D日本 and :P😀 and :Px')).toBe(
      `x :${Z}Pé and :${Z}D日本 and :${Z}P😀 and :Px`,
    );
  });

  it('leaves text that only looks like an emoticon alone', () => {
    expect(jira('(z) (ok) f(a) :Px :Data ;P ;( 12:30 http: x')).toBe(
      '(z) (ok) f(a) :Px :Data ;P ;( 12:30 http: x',
    );
  });

  it('keeps a literal backslash apart from what it would escape or break', () => {
    expect(jira(r`C:\path and \\server and a\\b`)).toBe(r`C:\path and \server and a\b`);
    expect(jira(r`\\(x) and \\* and \\\\`)).toBe(`\\${Z}\\(x) and \\${Z}* and \\${Z}\\`);
    expect(jira(r`\\*x*`)).toBe(`\\${Z}{_}x{_}`);
    // also before the `|` that follows link text or a table cell
    expect(jira(r`[a\\](https://x.y)`)).toBe(`[a\\${Z}|https://x.y]`);
    expect(jira('| h |\n|---|\n| C:\\\\ |')).toBe(`||h||\n|C:\\${Z}|`);
  });
});

describe('markdownToJira: links', () => {
  it('links absolute http(s), ftp(s), sftp and mailto URLs', () => {
    expect(
      jira(
        '[a](https://x.y) [b](http://x.y) [c](ftp://f.example) [d](sftp://s.example) [e](mailto:a@b.c)',
      ),
    ).toBe(
      '[a|https://x.y] [b|http://x.y] [c|ftp://f.example] [d|sftp://s.example] [e|mailto:a@b.c]',
    );
  });

  it('keeps only the text of links Jira cannot resolve', () => {
    expect(
      jira(
        '[ctx](ctxman:kb/ctxman) [rel](./concepts/x.md) [root](/concepts/y.md) [up](../z.md) [anchor](#top) [ssh](ssh://h) [proto](//cdn.x/a) [vs](vscode://file)',
      ),
    ).toBe('ctx rel root up anchor ssh proto vs');
    expect(jira('See [**the** `doc`](./doc.md).')).toBe('See *the* {{doc}}.');
  });

  it('writes autolinks and GFM autolink literals', () => {
    expect(jira('<https://x.y/a> and https://x.y/b and www.example.com and me@example.com')).toBe(
      '[https://x.y/a] and [https://x.y/b] and [www.example.com|http://www.example.com] and [me@example.com|mailto:me@example.com]',
    );
  });

  it('shows an autolink whose URL Jira would read as markup with an escaped text', () => {
    expect(jira('https://x.y/path_(x)/?a=-b-')).toBe(
      r`[https://x.y/path_\(x)/?a=\-b-|https://x.y/path_(x)/?a=-b-]`,
    );
  });

  it('writes [url] for a link without text', () => {
    expect(jira('[](https://x.y) and [ ](https://x.y)')).toBe('[https://x.y] and [https://x.y]');
  });

  it('keeps effects and code in the link text and escapes it like any text', () => {
    expect(jira('[**bold** link](https://x.y) and [`code`](https://x.y)')).toBe(
      '[*bold* link|https://x.y] and [{{code}}|https://x.y]',
    );
    expect(jira('[a {b} (x) c](https://x.y)')).toBe(r`[a \{b} \(x) c|https://x.y]`);
    expect(jira('[line  \nbreak](https://x.y)')).toBe('[line break|https://x.y]');
  });

  it('puts the link after the text when the text has [, ] or | (Jira link text cannot escape them)', () => {
    expect(jira('[a [b] c](https://x.y) and [a|b](https://x.y) and [`a|b`](https://x.y)')).toBe(
      r`a \[b] c ([https://x.y]) and a|b ([https://x.y]) and {{a|b}} ([https://x.y])`,
    );
  });

  it('puts the link after link text with an odd number of `!` from three on (Jira reads them as image markers)', () => {
    expect(jira("[Wow! Really! Yes!](https://x.y) and [Don't panic!!!](https://x.y)")).toBe(
      r`Wow! Really! Yes! ([https://x.y]) and Don't panic\!!! ([https://x.y])`,
    );
    expect(jira('[Hi!](https://x.y) and [Hi! Bye!](https://x.y)')).toBe(
      '[Hi!|https://x.y] and [Hi! Bye!|https://x.y]',
    );
  });

  it('percent-encodes what Jira would read inside the link target', () => {
    expect(jira('[x](<https://x.y/a b|c{d}e^f!g\\h[i]>)')).toBe(
      '[x|https://x.y/a%20b%7Cc%7Bd%7De%5Ef%21g%5Ch%5Bi%5D]',
    );
  });

  it('resolves full, collapsed and shortcut reference links and images (first definition wins)', () => {
    expect(
      jira(
        '[ref] and [text][ref] and [Ref][] and ![alt][img]\n\n[ref]: https://r.example/x "T"\n[ref]: https://other\n[img]: https://r.example/i.png',
      ),
    ).toBe(
      '[ref|https://r.example/x] and [text|https://r.example/x] and [Ref|https://r.example/x] and !https://r.example/i.png|alt=alt!',
    );
    expect(jira('[ref] and ![pic][ref]\n\n[ref]: ./local.md')).toBe('ref and pic');
  });

  it('keeps unmatched brackets as escaped text', () => {
    expect(jira('[not a link] and [x][missing]')).toBe(r`\[not a link] and \[x]\[missing]`);
  });
});

describe('markdownToJira: images', () => {
  it('shows absolute http(s) images with a cleaned alt text', () => {
    expect(jira('![Logo](https://i.example/l.png "title")')).toBe(
      '!https://i.example/l.png|alt=Logo!',
    );
    expect(jira('![](https://i.example/l.png)')).toBe('!https://i.example/l.png!');
    expect(jira('![a, b=c|d!e[f]{g}\n h](https://i.example/l.png)')).toBe(
      '!https://i.example/l.png|alt=a b c d e f g h!',
    );
  });

  it('keeps a space between an image and a letter, digit or other non-ASCII character it touches', () => {
    // (Cloud shows no image whose `!` touches one, and a later `!` would take the text into the image URL)
    expect(
      jira(
        'a ![i](https://x.y/i.png)word and word![j](https://x.y/j.png)! and é![k](https://x.y/k.png)é',
      ),
    ).toBe(
      'a !https://x.y/i.png|alt=i! word and word !https://x.y/j.png|alt=j!! and é !https://x.y/k.png|alt=k! é',
    );
    expect(jira('**![i](https://x.y/i.png)\\-x\\-**')).toBe(
      `*!https://x.y/i.png|alt=i! ${Z}\\-x-*`,
    );
  });

  it('writes the alt text (else the file name) of an image Jira cannot load', () => {
    expect(jira('![diagram](./diagram.png) and ![](img/a%20b.png?x=1#y) and ![](./)')).toBe(
      'diagram and a b.png and',
    );
    expect(
      jira(
        '![](data:image/png;base64,AAAA) ![pixel](data:image/png;base64,AAAA) ![](ftp://h/x.png)',
      ),
    ).toBe('pixel x.png');
    expect(jira('![](bad%E0name.png)')).toBe('bad%E0name.png');
  });

  it('writes an image link (README badges) as the image, then the link', () => {
    // (Cloud shows an image in link text on its own and the `!…!` as the link text)
    expect(jira('[![logo](https://i.example/l.png)](https://home.example)')).toBe(
      '!https://i.example/l.png|alt=logo! ([https://home.example])',
    );
    expect(
      jira('[![CI](https://x/b.svg)](https://x/a) [![Cov](https://y/c.svg)](https://y/d)'),
    ).toBe('!https://x/b.svg|alt=CI! ([https://x/a]) !https://y/c.svg|alt=Cov! ([https://y/d])');
    expect(jira('[![i](https://x.y/i.png) Click here!](https://z.z)')).toBe(
      '!https://x.y/i.png|alt=i! Click here! ([https://z.z])',
    );
    expect(jira('[**![i](https://x.y/i.png)**](https://z.z)')).toBe(
      '*!https://x.y/i.png|alt=i!* ([https://z.z])',
    );
    // an image Jira cannot load is its alt text, which stays the link text
    expect(jira('[![logo](./l.png)](https://home.example)')).toBe('[logo|https://home.example]');
  });
});

describe('markdownToJira: lists', () => {
  it('writes bullet and ordered lists with nesting by repeated or mixed markers', () => {
    expect(jira('- a\n- b\n  - c\n    1. d\n       - e\n- f')).toBe(
      '* a\n* b\n** c\n**# d\n**#* e\n* f',
    );
    expect(jira('- c\n  1. d\n  - e')).toBe('* c\n*# d\n** e');
    expect(jira('3. three\n4. four\n   1. sub')).toBe('# three\n# four\n## sub');
  });

  it('writes a loose list without blank lines (a blank line would end it)', () => {
    expect(jira('- a\n\n- b\n\n\n- c')).toBe('* a\n* b\n* c');
  });

  it('keeps every block of an item inside the item on the next lines', () => {
    expect(jira('1. a\n\n   second para\n\n   ```sh\n   ls -la\n\n   pwd\n   ```\n2. b')).toBe(
      '# a\nsecond para\n{code:bash}\nls -la\n\npwd\n{code}\n# b',
    );
    expect(jira('- a\n  > quoted\n  >\n  > twice\n- b')).toBe(
      '* a\n{quote}\nquoted\ntwice\n{quote}\n* b',
    );
    expect(jira('- a\n  <div>html</div>\n- b')).toBe('* a\nhtml\n* b');
    expect(jira('- a  \n  b')).toBe('* a\nb');
    expect(jira('- a\n  > - b\n  > - c\n- d')).toBe('* a\n{quote}\n* b\n* c\n{quote}\n* d');
  });

  it('writes a heading in an item in bold and drops a rule in an item', () => {
    expect(jira('- a\n  # Head *x*\n- b\n\n  ---\n- c')).toBe('* a\n*Head _x_*\n* b\n* c');
  });

  it('writes a heading in bold and drops a rule anywhere inside an item, also inside its quote or alert', () => {
    expect(jira('- a\n  > ## Head\n  > text\n  >\n  > ---\n  >\n  > more\n- b')).toBe(
      '* a\n{quote}\n*Head*\ntext\nmore\n{quote}\n* b',
    );
    expect(jira('1. a\n   > [!NOTE]\n   > ### Note head\n   > body')).toBe(
      '# a\n{panel:title=Note|bgColor=#deebff}\n*Note head*\nbody\n{panel}',
    );
  });

  it('ends the list around a table (a table cannot live in a Jira list)', () => {
    expect(jira('1. a\n   | x | y |\n   |---|---|\n   | 1 | 2 |\n2. b')).toBe(
      '# a\n\n||x||y||\n|1|2|\n\n# b',
    );
    expect(jira('- a\n  - b\n\n    | t |\n    |---|\n    | v |')).toBe('* a\n** b\n\n||t||\n|v|');
  });

  it('keeps an item that starts with a block or is empty with a no-break space', () => {
    expect(jira('- ```js\n  x\n  ```\n- after')).toBe(
      `* ${NBSP}\n{code:javascript}\nx\n{code}\n* after`,
    );
    expect(jira('- - x\n- after')).toBe(`* ${NBSP}\n** x\n* after`);
    expect(jira('-\n- b')).toBe(`* ${NBSP}\n* b`);
  });

  it('starts task items with a ballot box', () => {
    expect(jira('- [ ] todo\n- [x] done *now*\n- [X] also\n- plain')).toBe(
      '* ☐ todo\n* ☑ done _now_\n* ☑ also\n* plain',
    );
    expect(jira('1. [ ] first')).toBe('# ☐ first');
    expect(jira('- [ ] <!-- nothing -->\n- [ ]')).toBe('* ☐\n* \\[ ]');
  });

  it('escapes item text that would start a nested list or a heading', () => {
    expect(jira('- \\* x\n- h2. y')).toBe(`* \\* x\n* ${Z}h2. y`);
  });

  it('keeps separate lists apart', () => {
    expect(jira('- a\n\n* b\n\n1. c')).toBe('* a\n\n* b\n\n# c');
  });
});

describe('markdownToJira: blockquotes and alerts', () => {
  it('wraps a quote in {quote} with its paragraphs and blocks', () => {
    expect(jira('> one\n> line\n>\n> two\n>\n> - item\n> ```py\n> x = 1\n> ```')).toBe(
      '{quote}\none line\n\ntwo\n\n* item\n\n{code:python}\nx = 1\n{code}\n{quote}',
    );
  });

  it('flattens nested quotes ({quote} does not nest) and drops an empty one', () => {
    expect(jira('> a\n> > b\n> > > c')).toBe('{quote}\na\n\nb\n\nc\n{quote}');
    expect(jira('>\n\ntext')).toBe('text');
  });

  it('turns GitHub alerts into titled panels with the matching colour', () => {
    expect(jira('> [!NOTE]\n> Heads up')).toBe(
      '{panel:title=Note|bgColor=#deebff}\nHeads up\n{panel}',
    );
    expect(jira('> [!TIP]\n> t')).toBe('{panel:title=Tip|bgColor=#e3fcef}\nt\n{panel}');
    expect(jira('> [!IMPORTANT]\n> i')).toBe('{panel:title=Important|bgColor=#eae6ff}\ni\n{panel}');
    expect(jira('> [!WARNING]\n> w')).toBe('{panel:title=Warning|bgColor=#fffae6}\nw\n{panel}');
    expect(jira('> [!CAUTION]\n> c')).toBe('{panel:title=Caution|bgColor=#ffebe6}\nc\n{panel}');
  });

  it('reads the alert marker in any case, alone on its line, and keeps the rest of the alert', () => {
    expect(jira('> [!note]')).toBe('{panel:title=Note|bgColor=#deebff}\n{panel}');
    expect(jira('> [!Warning]  \n> **Careful** now\n>\n> - one')).toBe(
      '{panel:title=Warning|bgColor=#fffae6}\n*Careful* now\n\n* one\n{panel}',
    );
    expect(jira('> [!TIP]\n>\n> later')).toBe('{panel:title=Tip|bgColor=#e3fcef}\nlater\n{panel}');
  });

  it('keeps a quote whose marker is not an alert marker', () => {
    expect(jira('> [!NOTE] same line')).toBe('{quote}\n\\[!NOTE] same line\n{quote}');
    expect(jira('> [!UNKNOWN]\n> text')).toBe('{quote}\n\\[!UNKNOWN] text\n{quote}');
    expect(jira('> text\n> [!NOTE]')).toBe('{quote}\ntext \\[!NOTE]\n{quote}');
  });

  it('reads an alert marker only from the source: an escaped marker or one with more on its line is text', () => {
    expect(jira('> \\[!NOTE]\n> escaped')).toBe('{quote}\n\\[!NOTE] escaped\n{quote}');
    expect(jira('> [!NOTE]<br>text')).toBe('{quote}\n\\[!NOTE]\ntext\n{quote}');
    expect(jira('> &#91;!NOTE]\n> entity')).toBe('{quote}\n\\[!NOTE] entity\n{quote}');
  });

  it('keeps {quote} and {panel} inside a quote or panel from closing it early', () => {
    expect(jira('> use {quote} here')).toBe('{quote}\nuse \\{quote\\} here\n{quote}');
    expect(jira('> [!NOTE]\n> use {panel} and {quote}')).toBe(
      '{panel:title=Note|bgColor=#deebff}\nuse \\{panel\\} and \\{quote\\}\n{panel}',
    );
    // in a code block the tag of the open macro is broken with a zero-width space
    expect(jira('> ```\n> {quote} and {panel}\n> ```')).toBe(
      `{quote}\n{noformat}\n{${Z}quote} and {panel}\n{noformat}\n{quote}`,
    );
    expect(
      jira('> [!TIP]\n> ```js\n> x = "{panel}{Quote}"\n> ```\n>\n> > ```\n> > {QUOTE}\n> > ```'),
    ).toBe(
      `{panel:title=Tip|bgColor=#e3fcef}\n{code:javascript}\nx = "{${Z}panel}{Quote}"\n{code}\n\n{quote}\n{noformat}\n{${Z}QUOTE}\n{noformat}\n{quote}\n{panel}`,
    );
  });

  it('nests a quote in a panel and a panel in a quote, and flattens a panel in a panel', () => {
    expect(jira('> [!TIP]\n> a\n>\n> > q')).toBe(
      '{panel:title=Tip|bgColor=#e3fcef}\na\n\n{quote}\nq\n{quote}\n{panel}',
    );
    expect(jira('> q\n>\n> > [!NOTE]\n> > n')).toBe(
      '{quote}\nq\n\n{panel:title=Note|bgColor=#deebff}\nn\n{panel}\n{quote}',
    );
    expect(jira('> [!TIP]\n> > [!NOTE]\n> > inner')).toBe(
      '{panel:title=Tip|bgColor=#e3fcef}\ninner\n{panel}',
    );
  });

  it('keeps a panel inside a list item without blank lines', () => {
    expect(jira('- a\n  > [!NOTE]\n  > x\n  >\n  > y')).toBe(
      '* a\n{panel:title=Note|bgColor=#deebff}\nx\ny\n{panel}',
    );
  });
});

describe('markdownToJira: code blocks', () => {
  it('writes {code:<lang>} for a language Jira knows and keeps the body literal', () => {
    expect(jira('```python\nprint("*hi* {x} [y] | -- (x)")\n```')).toBe(
      '{code:python}\nprint("*hi* {x} [y] | -- (x)")\n{code}',
    );
    expect(jira('```TypeScript title="x.ts"\nconst a = 1;\n```')).toBe(
      '{code:javascript}\nconst a = 1;\n{code}',
    );
    expect(jira('```yml\na: 1\n```')).toBe('{code:yaml}\na: 1\n{code}');
  });

  it('writes {noformat} for no language, an unknown one and indented code', () => {
    expect(jira('```\nplain\n```')).toBe('{noformat}\nplain\n{noformat}');
    expect(jira('```mermaid\ngraph TD\n```')).toBe('{noformat}\ngraph TD\n{noformat}');
    expect(jira('    indented\n    code')).toBe('{noformat}\nindented\ncode\n{noformat}');
  });

  it('keeps tabs, blank lines and trailing spaces of the body', () => {
    expect(jira('```\n\tTab\n\nend  \n```')).toBe('{noformat}\n\tTab\n\nend  \n{noformat}');
    expect(jira('```js\r\na\r\n\r\nb\r\n```')).toBe('{code:javascript}\na\n\nb\n{code}');
  });

  it('writes an empty block without a body line', () => {
    expect(jira('```\n```')).toBe('{noformat}\n{noformat}');
    expect(jira('```js\n```')).toBe('{code:javascript}\n{code}');
  });

  it('switches to the other macro when the body holds the closing tag', () => {
    expect(jira('```js\n{code}\n```')).toBe('{noformat}\n{code}\n{noformat}');
    expect(jira('```\n{noformat}\n```')).toBe('{code}\n{noformat}\n{code}');
    expect(jira('```text\nsee {Code} and {code:java}\n```')).toBe(
      '{noformat}\nsee {Code} and {code:java}\n{noformat}',
    );
  });

  it('breaks the closing tag with a zero-width space when the body holds both closing tags', () => {
    expect(jira('```js\n{code}\n{noformat}\n```')).toBe(
      `{code:javascript}\n{${Z}code}\n{noformat}\n{code}`,
    );
    expect(jira('```\n{NoFormat}\n{code}\n```')).toBe(
      `{noformat}\n{${Z}NoFormat}\n{code}\n{noformat}`,
    );
  });
});

describe('jiraCodeLanguage', () => {
  it('maps common aliases onto the Jira Server/DC language set', () => {
    const cases: [string, string][] = [
      ['ts', 'javascript'],
      ['tsx', 'javascript'],
      ['typescript', 'javascript'],
      ['jsx', 'javascript'],
      ['mjs', 'javascript'],
      ['js', 'javascript'],
      ['shell', 'bash'],
      ['sh', 'bash'],
      ['zsh', 'bash'],
      ['console', 'bash'],
      ['yml', 'yaml'],
      ['py', 'python'],
      ['rb', 'ruby'],
      ['golang', 'go'],
      ['cpp', 'c++'],
      ['c++', 'c++'],
      ['csharp', 'c#'],
      ['cs', 'c#'],
      ['c#', 'c#'],
      ['objective-c', 'objc'],
      ['kotlin', 'java'],
      ['svg', 'xml'],
      ['vue', 'html'],
      ['astro', 'html'],
      ['scss', 'css'],
      ['jsonc', 'json'],
      ['postgresql', 'sql'],
      ['vb.net', 'visualbasic'],
      ['hs', 'haskell'],
      ['erl', 'erlang'],
      ['gradle', 'groovy'],
      ['pl', 'perl'],
      ['as', 'actionscript'],
      ['applescript', 'applescript'],
      ['ada', 'ada'],
      ['lua', 'lua'],
      ['php', 'php'],
      ['r', 'r'],
      ['scala', 'scala'],
      ['swift', 'swift'],
      ['c', 'c'],
      ['nyan', 'nyan'],
      ['rainbow', 'rainbow'],
    ];
    for (const [alias, jiraName] of cases) expect(jiraCodeLanguage(alias), alias).toBe(jiraName);
  });

  it('reads the first word of an info string in any case', () => {
    expect(jiraCodeLanguage('  TS title="a.ts" {1,3}')).toBe('javascript');
    expect(jiraCodeLanguage('Python3')).toBe('python');
  });

  it('answers null for no language and languages Jira Server/DC lacks', () => {
    for (const lang of [
      null,
      undefined,
      '',
      '  ',
      'text',
      'txt',
      'md',
      'markdown',
      'mermaid',
      'diff',
      'toml',
      'ini',
      'rust',
      'dockerfile',
      'powershell',
      '{.python}',
    ]) {
      expect(jiraCodeLanguage(lang), String(lang)).toBeNull();
    }
  });
});

describe('markdownToJira: tables', () => {
  it('writes a header row with || and body rows with |, ignoring alignment', () => {
    expect(jira('| a | b | c |\n| :-- | :-: | --: |\n| 1 | *2* | `3` |')).toBe(
      '||a||b||c||\n|1|_2_|{{3}}|',
    );
  });

  it('escapes pipes in cells, also inside code, and line-start markers', () => {
    expect(jira('| h |\n|---|\n| a \\| b |\n| `x\\|y` |\n| - x |\n| * y |\n| # z |')).toBe(
      r`||h||
|a \| b|
|{{x\|y}}|
|\- x|
|\* y|
|\# z|`,
    );
  });

  it('writes a line break in a cell as \\\\ (a space after it when a backslash follows in the same word)', () => {
    expect(jira('| h |\n|---|\n| line<br>two |\n| a<br/>C:\\\\x\\\\y |\n| C:\\\\x<br>y |')).toBe(
      r`||h||
|line\\two|
|a\\ C:\x\y|
|C:\x\\y|`,
    );
  });

  it('puts a space after a cell line break before any backslash, an escape of ours too', () => {
    expect(
      jira(
        '| h |\n|---|\n| a<br>{x} |\n| a<br>[x] |\n| a<br>(x) |\n| a<br>-b- |\n| a<br>+b+ |\n| a<br>^c^ |\n| a<br>!i! |',
      ),
    ).toBe(r`||h||
|a\\ \{x}|
|a\\ \[x]|
|a\\ \(x)|
|a\\ \-b-|
|a\\ \+b+|
|a\\ \^c^|
|a\\ \!i!|`);
    expect(jira('| h |\n|---|\n| a<br>b<br>c |\n| a<br><br>b |')).toBe(r`||h||
|a\\ b\\c|
|a\\ \\b|`);
  });

  it('drops a line break at either end of a cell', () => {
    expect(jira('| h |\n|---|\n| <br>a<br> |\n| <br> |')).toBe('||h||\n|a|\n| |');
  });

  it('fills empty cells and short rows with a space and drops extra cells', () => {
    expect(jira('| a | b |\n|---|---|\n|  | x |\n| 1 |\n| 1 | 2 | 3 |')).toBe(
      '||a||b||\n| |x|\n|1| |\n|1|2|',
    );
    expect(jira('|  | b |\n|---|---|\n| 1 | 2 |')).toBe('|| ||b||\n|1|2|');
  });

  it('keeps links and images in cells, the image without an alt attribute', () => {
    expect(
      jira('| l | i |\n|---|---|\n| [l](https://h.example/a) | ![i](https://h.example/i.png) |'),
    ).toBe('||l||i||\n|[l|https://h.example/a]|!https://h.example/i.png!|');
  });

  it('escapes braces and effects in cells like in any text', () => {
    expect(jira('| h |\n|---|\n| {x} and \\*y\\* and a\\_b |')).toBe(r`||h||
|\{x} and \*y* and a_b|`);
  });
});

describe('markdownToJira: HTML', () => {
  it('drops comments, block and inline', () => {
    expect(jira('a\n\n<!-- block\ncomment -->\n\nb <!-- inline --> c')).toBe('a\n\nb  c');
  });

  it('keeps the text of other tags, block-level tags and <br> as line breaks', () => {
    expect(jira('<div align="center">\n<b>Bold</b> text\n</div>')).toBe('*Bold* text');
    expect(jira('<p>one</p><p>two</p>')).toBe('one\ntwo');
    expect(jira('<details>\n<summary>Sum</summary>\ninner\n</details>')).toBe('Sum\ninner');
    expect(jira('<div>\na<br>b\n</div>')).toBe('a\nb');
    expect(jira('a <kbd>Ctrl</kbd>+<kbd>K</kbd> b')).toBe('a {{Ctrl}}+{{K}} b');
  });

  it('maps inline effect and code tags', () => {
    expect(
      jira(
        'a <b>b</b> <strong>s</strong> <i>i</i> <em>e</em> <s>s</s> <del>d</del> <strike>k</strike>',
      ),
    ).toBe('a *b* *s* _i_ _e_ -s- -d- -k-');
    expect(jira('<u>under</u>line, <ins>ins</ins>, x<sup>2</sup>, H<sub>2</sub>O')).toBe(
      '{+}under{+}line, +ins+, x{^}2{^}, H{~}2{~}O',
    );
    expect(jira('a <code>x {y}</code> <samp>out</samp> <tt>tt</tt>')).toBe(
      r`a {{x \{y\}}} {{out}} {{tt}}`,
    );
  });

  it('maps <a href> like a markdown link and <img> like a markdown image', () => {
    expect(
      jira(
        'a <a href="https://x.y/a?b=1&amp;c=2">link <b>b</b></a>, <a href="./r.md">rel</a>, <a name="n">n</a>',
      ),
    ).toBe('a [link *b*|https://x.y/a?b=1&c=2], rel, n');
    expect(
      jira(
        '<img src="https://x.y/i.png" alt="Logo"> <img src="./l.png" alt="local"> <IMG SRC="https://x.y/j.png">',
      ),
    ).toBe('!https://x.y/i.png|alt=Logo! local !https://x.y/j.png!');
    expect(
      jira(
        '<p align="center">\n  <a href="https://x/a"><img src="https://x/b.svg" alt="CI"></a>\n</p>',
      ),
    ).toBe('!https://x/b.svg|alt=CI! ([https://x/a])');
  });

  it('writes <hr> as a rule line (none in a list item) and in a cell or heading as a break or space', () => {
    expect(jira('a <hr> b')).toBe('a\n----\nb');
    expect(jira('<hr>')).toBe('----');
    expect(jira('- a\n  <hr>\n- b')).toBe('* a\n* b');
    expect(jira('| h |\n|---|\n| a <hr/> b |\n\n## x <hr> y')).toBe(r`||h||
|a \\ b|

h2. x   y`);
  });

  it('keeps a no-break space of an HTML block (a line start after it is no markup)', () => {
    expect(jira('<div>\n&nbsp;h1. x\n&nbsp;- y\n</div>')).toBe(`${NBSP}h1. x\n${NBSP}- y`);
  });

  it('drops <script>, <style> and <template> with their content', () => {
    expect(jira('a <script>x()</script> b <style>.x{}</style> c <template>t</template> d')).toBe(
      'a  b  c  d',
    );
    expect(
      jira(
        '<div>\nkeep\n<script>\nif (a < b) { w("</div>"); }\n</script>\n<style>p { }</style>\nend\n</div>',
      ),
    ).toBe('keep\nend');
  });

  it('keeps only the text of unbalanced tags', () => {
    expect(jira('a <b>unclosed and </i>stray')).toBe('a unclosed and stray');
    expect(jira('x <b>a<i>b</b>c</i> y')).toBe('x {*}ab{*}c y');
    expect(jira('<div>\na <b>b\n</div>')).toBe('a b');
  });

  it('flattens elements nested in their own kind, however deep', () => {
    expect(jira('x <b><strong>y</strong></b> z')).toBe('x *y* z');
    expect(jira(`x ${'<b>'.repeat(5000)}y${'</b>'.repeat(5000)} z`)).toBe('x *y* z');
  });

  it('drops processing instructions, declarations and an unclosed comment in a block', () => {
    expect(jira('<?php echo 1; ?>')).toBe('');
    expect(jira('<!DOCTYPE html>')).toBe('');
    expect(jira('a <![CDATA[x > y]]> b <?pi?> c')).toBe('a  b  c');
    expect(jira('<!-- never closed\n\nstill comment')).toBe('');
  });

  it('decodes entities in HTML and escapes the text', () => {
    expect(
      jira('<div>\n&amp; &lt;tag&gt; &copy; &#169; &#x1F600; &#0; &unknown; {x}\n</div>'),
    ).toBe(r`& <tag> © © 😀 ` + '\uFFFD' + r` &unknown; \{x}`);
    expect(jira('a <span title="x">b</span> &amp;&nbsp;c')).toBe(`a b &${NBSP}c`);
  });

  it('keeps text that only looks like HTML', () => {
    expect(jira('a <!-- unclosed and 1 < 2 > 0')).toBe('a <!-- unclosed and 1 < 2 > 0');
  });
});

describe('markdownToJira: footnotes', () => {
  it('numbers references in first-reference order and lists the notes after a rule', () => {
    expect(
      jira('Text[^b] and again[^b] and[^a].\n\n[^a]: First defined.\n[^b]: Second defined.'),
    ).toBe('Text¹ and again¹ and².\n\n----\n\n# Second defined.\n# First defined.');
  });

  it('keeps notes nobody references, renumbers notes cited from notes, and keeps note blocks', () => {
    expect(jira('A[^a].\n\n[^a]: See[^b].\n[^b]: B.\n[^z]: Unused.')).toBe(
      'A¹.\n\n----\n\n# See².\n# B.\n# Unused.',
    );
    expect(jira('X[^n]\n\n[^n]: First\n\n    ```sh\n    ls\n    ```\n\n    more')).toBe(
      'X¹\n\n----\n\n# First\n{code:bash}\nls\n{code}\nmore',
    );
  });

  it('writes two-digit numbers in superscript too', () => {
    const refs = Array.from({ length: 12 }, (_, i) => `[^n${i}]`).join(' ');
    const defs = Array.from({ length: 12 }, (_, i) => `[^n${i}]: N${i}.`).join('\n');
    expect(jira(`${refs}\n\n${defs}`).split('\n\n')[0]).toBe('¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ¹⁰ ¹¹ ¹²');
  });

  it('keeps a reference without a definition as escaped text', () => {
    expect(jira('Footnote[^x] here.')).toBe(r`Footnote\[^x] here.`);
  });

  it('lists notes even when the body has no reference', () => {
    expect(jira('[^a]: Only a note.')).toBe('----\n\n# Only a note.');
  });
});

describe('markdownToJira: a ctxman document end to end', () => {
  it('converts a realistic okf concept', () => {
    const md = [
      '---',
      'type: Concept',
      'title: Demo',
      '---',
      '',
      '# Demo',
      '',
      'Run `pnpm run check` before you commit; see [Editing](/concepts/editing.md) and',
      '[the context](ctxman:context/ctxman-dev). Paths like `{dataset}/{slug}` are *placeholders*.',
      '',
      '## Steps',
      '',
      '1. Install with `pnpm install --frozen-lockfile`.',
      '2. Start the server:',
      '',
      '   ```bash',
      '   CTXMAN_DATA_DIR=tests/data pnpm run dev',
      '   ```',
      '3. Open http://127.0.0.1:4321.',
      '',
      '| Command | Does |',
      '| --- | --- |',
      '| `check` | data + schemas (0 errors \\| 0 warnings) |',
      '',
      '> [!WARNING]',
      '> Never write to `tests/data` from a test.',
    ].join('\n');
    expect(jira(md)).toBe(
      [
        'h1. Demo',
        '',
        'Run {{pnpm run check}} before you commit; see Editing and the context. Paths like {{\\{dataset\\}/\\{slug\\}}} are _placeholders_.',
        '',
        'h2. Steps',
        '',
        '# Install with {{pnpm install --frozen-lockfile}}.',
        '# Start the server:',
        '{code:bash}',
        'CTXMAN_DATA_DIR=tests/data pnpm run dev',
        '{code}',
        '# Open [http://127.0.0.1:4321].',
        '',
        '||Command||Does||',
        '|{{check}}|data + schemas (0 errors \\| 0 warnings)|',
        '',
        '{panel:title=Warning|bgColor=#fffae6}',
        'Never write to {{tests/data}} from a test.',
        '{panel}',
      ].join('\n'),
    );
  });
});
