// Edge and adversarial cases for markdown -> Jira wiki markup (src/lib/jira-markup.ts), beside jira-markup.test.ts:
// document framing (frontmatter, line endings, tabs, unicode), headings, nested and adjacent effects, inline code
// next to non-ASCII text, entities and source backslash escapes, emoticon boundaries, links and images with odd
// targets, deeply nested lists / quotes / code / tables, alert marker variants, footnote placement, table cells with
// line breaks, HTML blocks and a seeded structure check (every word of a nested document survives exactly once,
// macros stay balanced). Every expectation is the output the module's documented policy asks for (see
// tests/data/kb/ctxman/concepts/jira-markup.md). PURE: no fs.
import { describe, expect, it } from 'vitest';
import { jiraCodeLanguage, markdownToJira as jira } from '../../src/lib/jira-markup.ts';

const r = String.raw;
/** The zero-width space used where Jira has no backslash escape. */
const Z = '​';
const NBSP = ' ';

describe('markdownToJira: document framing', () => {
  it('turns a document that is only frontmatter into an empty string', () => {
    expect(jira('---\ntitle: x\n---')).toBe('');
    expect(jira('---\ntitle: x\n---\n')).toBe('');
    expect(jira('﻿---\r\ntitle: x\r\n---\r\n')).toBe('');
  });

  it('accepts trailing spaces on the frontmatter fences and keeps a rule that follows the block', () => {
    expect(jira('---  \ntitle: x\n---  \nbody')).toBe('body');
    expect(jira('---\ntitle: x\n---\n\n---\n\nafter rule')).toBe('----\n\nafter rule');
    expect(jira('---\ntitle: "a --- b"\n---\n# H')).toBe('h1. H');
  });

  it('reads a `---` block that is not at the very start as a rule and a setext heading', () => {
    expect(jira('\n---\ntitle: x\n---\nbody')).toBe('----\n\nh2. title: x\n\nbody');
    expect(jira(' ---\ntitle: x\n---\nbody')).toBe('----\n\nh2. title: x\n\nbody');
    expect(jira('---\ntitle: x\n----\nbody')).toBe('----\n\nh2. title: x\n\nbody');
  });

  it('normalizes CRLF and CR inside fenced code, tables, nested lists and quotes', () => {
    expect(jira('```\r\na\r\nb\r\n```\r\n')).toBe('{noformat}\na\nb\n{noformat}');
    expect(jira('| a |\r\n|---|\r\n| b |\r\n')).toBe('||a||\n|b|');
    expect(jira('- a\r\n  - b\r\n')).toBe('* a\n** b');
    expect(jira('> a\r\n> b')).toBe('{quote}\na b\n{quote}');
    expect(jira('a\rb\rc')).toBe('a b c');
  });

  it('trims blank lines and spaces around the document and keeps no trailing newline', () => {
    expect(jira('\n\n\ntext\n\n\n')).toBe('text');
    expect(jira('   leading')).toBe('leading');
    expect(jira('tail   \n')).toBe('tail');
    expect(jira('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('turns tabs into spaces in text and keeps list nesting made with tabs', () => {
    expect(jira('a\tb\t\tc')).toBe('a b  c');
    expect(jira('-\ta\n\t- b\n\t\t- c')).toBe('* a\n** b\n*** c');
    expect(jira('1.\tone\n2.\ttwo')).toBe('# one\n# two');
    expect(jira('| a\t| b |\n|---|---|\n| x\ty | z |')).toBe('||a||b||\n|x y|z|');
    expect(jira('```\n\ta\n\t\tb\n```')).toBe('{noformat}\n\ta\n\t\tb\n{noformat}');
    expect(jira('\tindented\n\tcode')).toBe('{noformat}\nindented\ncode\n{noformat}');
  });

  it('keeps unicode, right-to-left text, a lone surrogate and an existing zero-width space as they are', () => {
    expect(jira('Ünïcödé ÀÉÎ ß ç ñ')).toBe('Ünïcödé ÀÉÎ ß ç ñ');
    expect(jira('RTL: שלום עולם **مرحبا**')).toBe('RTL: שלום עולם *مرحبا*');
    expect(jira('👨‍👩‍👧 **fam**')).toBe('👨‍👩‍👧 *fam*');
    expect(jira('ZWSP:​here')).toBe('ZWSP:​here');
    expect(jira('\uD800')).toBe('\uD800');
    expect(jira('a\u0000b')).toBe('a�b');
  });

  it('does not read a no-break space or a zero-width space before a marker as a list or table', () => {
    expect(jira(`${NBSP}* x`)).toBe(`${NBSP}* x`);
    expect(jira(`${Z}# x`)).toBe(`${Z}# x`);
    expect(jira('&nbsp;|x')).toBe(`${NBSP}|x`);
  });

  it('converts a long line and a document with thousands of blocks without losing a word', () => {
    const words = Array.from({ length: 20000 }, (_, i) => `w${i}`);
    expect(jira(words.join(' '))).toBe(words.join(' '));
    const paragraphs = Array.from({ length: 3000 }, (_, i) => `para ${i}`);
    expect(jira(paragraphs.join('\n\n'))).toBe(paragraphs.join('\n\n'));
  });

  it('never throws, and never leaves a CR or the text "undefined", for hostile input', () => {
    const hostile = [
      '\u0000',
      '𐀀\uDC00',
      '[^1]',
      '[^1]: [^1]',
      '[a]: [a]',
      '![](',
      '[](',
      '> '.repeat(300) + 'x',
      '- '.repeat(300) + 'x',
      '| a |\n|---|\n' + '| `x |\n'.repeat(5),
      '```'.repeat(50),
      '<!--'.repeat(50),
      '**'.repeat(300),
      '`'.repeat(300),
      '{{'.repeat(300) + '}}'.repeat(300),
      '\\'.repeat(301),
      '[[[[[[[[[[]]]]]]]]]]',
      '(x)(x)(x):):):)',
      '> [!NOTE]\n'.repeat(20),
      '&#x110000; &#99999999; &bogus; &',
    ];
    for (const md of hostile) {
      const out = jira(md);
      expect(out, md.slice(0, 20)).not.toContain('\r');
      expect(out, md.slice(0, 20)).not.toContain('undefined');
    }
  });
});

describe('markdownToJira: headings, more', () => {
  it('drops closing hashes and keeps escaped ones', () => {
    expect(jira('## Title ##')).toBe('h2. Title');
    expect(jira('## C# ##')).toBe('h2. C#');
    expect(jira('## C\\# \\##')).toBe('h2. C# ##');
    expect(jira('  # indented heading')).toBe('h1. indented heading');
  });

  it('joins a multi-line setext heading and keeps text that is not a heading', () => {
    expect(jira('Setext line one\nline two\n===')).toBe('h1. Setext line one line two');
    expect(jira('#hashtag')).toBe('#hashtag');
    expect(jira('####### seven')).toBe(r`\####### seven`);
    expect(jira('# 1. Not a list')).toBe('h1. 1. Not a list');
  });

  it('writes links, images, code and footnote references in a heading', () => {
    expect(jira('## [a|b](https://x.y)')).toBe('h2. a|b ([https://x.y])');
    expect(jira('## ![i](https://x.y/i.png) Title')).toBe('h2. !https://x.y/i.png|alt=i! Title');
    expect(jira('## `code` heading')).toBe('h2. {{code}} heading');
    expect(jira('## {x} [y]')).toBe(r`h2. \{x} \[y]`);
    expect(jira('## Heading with **bold**text and *em*')).toBe(
      'h2. Heading with {*}bold{*}text and _em_',
    );
    expect(jira('# Heading[^n]\n\n[^n]: note')).toBe('h1. Heading¹\n\n----\n\n# note');
  });

  it('separates a heading from the text around it with blank lines', () => {
    expect(jira('text\n# heading right after\nmore text')).toBe(
      'text\n\nh1. heading right after\n\nmore text',
    );
    expect(jira('text\n***')).toBe('text\n\n----');
  });
});

describe('markdownToJira: effects, more', () => {
  it('keeps effects around code, links, images and footnote references apart', () => {
    expect(jira('**a**`b`**c**')).toBe('*a*{{b}}*c*');
    expect(jira('**a**[l](https://x.y)**b**')).toBe('*a*[l|https://x.y]*b*');
    expect(jira('**a**![i](https://x.y/i.png)**b**')).toBe('*a*!https://x.y/i.png|alt=i!*b*');
    expect(jira('*a*[^1]*b*\n\n[^1]: n')).toBe('{_}a{_}¹{_}b{_}\n\n----\n\n# n');
    expect(jira('**a**.**b**')).toBe('*a*.*b*');
    expect(jira('**a**,*b*')).toBe('*a*,_b_');
  });

  it('uses the {*} form when a letter or digit touches an effect on either side', () => {
    expect(jira('x**a**-**b**y')).toBe('x{*}a{*}-{*}b{*}y');
    expect(jira('**foo**bar**baz**')).toBe('{*}foo{*}bar{*}baz{*}');
    expect(jira('a*b*c*d*e')).toBe('a{_}b{_}c{_}d{_}e');
    expect(jira('x1**y**')).toBe('x1{*}y{*}');
  });

  it('treats an emoji, a combining accent and CJK punctuation like any non-ASCII character', () => {
    expect(jira('**x**😀 and 😀**x** and **😀**')).toBe('{*}x{*}😀 and 😀{*}x{*} and *😀*');
    expect(jira('é**x**')).toBe('é{*}x{*}');
    expect(jira('*「a」*')).toBe('_「a」_');
    expect(jira('**a**　**b**')).toBe('{*}a{*}　{*}b{*}');
    expect(jira('_日本語_ and _é_')).toBe('_日本語_ and _é_');
    expect(jira('x_日本_y')).toBe('x_日本_y');
  });

  it('keeps underscores inside an emphasis and dates, ranges and kebab-case inside a strikethrough', () => {
    expect(jira('*snake_case* and _a_b_')).toBe('_snake_case_ and _a_b_');
    expect(jira('~~2026-10-21~~ and ~~a-b-c~~')).toBe('-2026-10-21- and -a-b-c-');
    expect(jira('~~x -y~~')).toBe(r`-x \-y-`);
  });

  it('closes and reopens an effect around a line break in a table cell', () => {
    expect(jira('| h |\n|---|\n| **a<br>b** |')).toBe(r`||h||
|*a*\\*b*|`);
  });
});

describe('markdownToJira: inline code, more', () => {
  it('pulls non-ASCII neighbours into the span, since Cloud counts them as letters, and keeps ASCII punctuation outside', () => {
    expect(jira('`x`😀 and 😀`x`')).toBe('{{x😀}} and {{😀x}}');
    expect(jira('`code`—dash and “`q`” and (`p`)')).toBe('{{code—dash}} and {{“q”}} and ({{p}})');
    expect(jira('`1`2')).toBe('{{12}}');
    expect(jira('`a`,`b`;`c`')).toBe('{{a}},{{b}};{{c}}');
    expect(jira('`a` is `b`.')).toBe('{{a}} is {{b}}.');
  });

  it('escapes braces and brackets of every kind inside code', () => {
    expect(jira('`{x}` and `{{x}}` and `a}}b` and `}` and `{`')).toBe(
      r`{{\{x\}}} and {{\{\{x\}\}}} and {{a\}\}b}} and {{\}}} and {{\{}}`,
    );
    expect(jira('`[~u]` `[a|b]` `[a](b)`')).toBe(r`{{\[~u]}} {{\[a|b]}} {{\[a](b)}}`);
  });

  it('keeps text that would be markup at a line start as is inside code', () => {
    expect(jira('`- x` `# x` `| x` `h1. x`')).toBe('{{- x}} {{# x}} {{| x}} {{h1. x}}');
    expect(jira('x `h1. x`')).toBe('x {{h1. x}}');
    expect(jira('`----`')).toBe(r`{{\-\---}}`);
  });

  it('escapes the effect markers of code that could pair up on the line', () => {
    expect(jira('`-a-` `*b*` `_c_` `+d+` `^e^` `~f~` `??g??` `!h!`')).toBe(
      r`{{\-a-}} {{\*b*}} {{\_c_}} {{\+d+}} {{\^e^}} {{\~f~}} {{\??g??}} {{\!h!}}`,
    );
  });

  it('writes spans with backticks, line breaks and long runs of spaces', () => {
    expect(jira('```` ``a`` ````')).toBe('{{``a``}}');
    expect(jira('`` a`b ``')).toBe('{{a`b}}');
    expect(jira('`a\nb`')).toBe('{{a b}}');
    expect(jira('`a  b   c`')).toBe('{{a  b   c}}');
    expect(jira('`é` `日本語` `😀`')).toBe('{{é}} {{日本語}} {{😀}}');
  });

  it('keeps a code span in a table cell with its escaped pipe and braces', () => {
    expect(jira('| h |\n|---|\n| `a\\|b` and `{{x}}` and `\\|` |')).toBe(r`||h||
|{{a\|b}} and {{\{\{x\}\}}} and {{\|}}|`);
  });
});

describe('markdownToJira: escaping, more', () => {
  it('decodes character references, then escapes the result like any text', () => {
    expect(jira('a &amp; b &lt; c &gt; d &quot;e&quot; &copy;')).toBe('a & b < c > d "e" ©');
    expect(jira('&#123;x&#125; &lbrace;y&rbrace; &#x5B;z&#x5D;')).toBe(r`\{x} \{y} \[z]`);
    expect(jira('&#42;not bold&#42; and &ast;x&ast; and &lowbar;y&lowbar;')).toBe(
      r`\*not bold* and \*x* and \_y_`,
    );
    expect(jira('&#40;x&#41; and &lpar;x&rpar; and &colon;&rpar;')).toBe(r`\(x) and \(x) and :\)`);
    expect(jira('&#x2d;&#x2d; and a &#45;&#45; b')).toBe(r`\-- and a \-- b`);
    expect(jira('&amp;amp; and &amp;lt;')).toBe('&amp; and &lt;');
  });

  it('keeps every backslash-escaped punctuation character as that character', () => {
    expect(jira(r`\* \_ \{ \} \[ \] \( \) \# \+ \- \. \! \| \\ \~ \^ \? \: \;`)).toBe(
      r`\* _ \{ } \[ ] ( ) # + - . ! | \ ~ ^ ? : ;`,
    );
    expect(jira(r`5 \* 3 = 15 and a\_b\_c`)).toBe('5 * 3 = 15 and a_b_c');
    expect(jira(r`\{\{x\}\}`)).toBe(r`\{\{x}}`);
  });

  it('keeps a literal `\\*` apart from the emphasis marker and a UNC path intact', () => {
    expect(jira(r`\\\\server\\share`)).toBe(`\\${Z}\\server\\share`);
    expect(jira(r`\\*not em\\*`)).toBe(`\\${Z}{_}not em\\${Z}{_}`);
  });

  it('escapes an emoticon wherever it sits (word, punctuation, line end) and only a complete one', () => {
    expect(jira('(x). and ((x)) and "(y)" and f(x) and (x)y')).toBe(
      r`\(x). and (\(x)) and "\(y)" and f\(x) and \(x)y`,
    );
    expect(jira('(y)(n) (i)(/)')).toBe(r`\(y)\(n) \(i)\(/)`);
    expect(jira(':) at end :)')).toBe(r`:\) at end :\)`);
    expect(jira(';-) and :-(')).toBe(r`;\-) and :\-(`);
    expect(jira('a :( b')).toBe(r`a :\( b`);
    expect(jira('(xx) (flag-) (on')).toBe('(xx) (flag-) (on');
  });

  it('escapes + and ^ only where they could open an effect', () => {
    expect(jira('C++ and +x+ and +1 and a +b')).toBe(r`C++ and \+x+ and +1 and a +b`);
    expect(jira('x^2 and ^y^ and a ^b')).toBe(r`x^2 and \^y^ and a ^b`);
  });

  it('leaves numbers, ranges and dates written with dashes alone', () => {
    expect(jira('(-1, -2) and x -1 y and 2026-10-21')).toBe('(-1, -2) and x -1 y and 2026-10-21');
    expect(jira('1986\\. A great year')).toBe('1986. A great year');
  });

  it('escapes literal underscores that could open an emphasis', () => {
    expect(jira(r`\_private and \_\_dunder\_\_`)).toBe(r`\_private and \_\_dunder__`);
  });

  it('escapes list, rule and table markers at the start of an item and of each continuation paragraph of an item', () => {
    expect(jira('- \\- x\n- \\# y\n- \\| z\n- \\---- w')).toBe(
      r`* \- x
* \# y
* \| z
* \-\--- w`,
    );
    expect(jira('1. \\- x')).toBe(r`# \- x`);
    expect(jira('* a\n\n  \\* second\n\n  \\# hash\n\n  \\| pipe\n* b')).toBe(
      r`* a
\* second
\# hash
\| pipe
* b`,
    );
  });

  it('writes line breaks of a hard-wrapped item as one line', () => {
    expect(jira('- a\n  b\n  c')).toBe('* a b c');
    expect(jira('- a\\\n  b\\\n  c')).toBe('* a\nb\nc');
    expect(jira('- a  \n  - b  \n    c')).toBe('* a\n** b\nc');
  });
});

describe('markdownToJira: links, more', () => {
  it('leaves the punctuation around an autolink outside it', () => {
    expect(
      jira(
        'Visit https://x.y/a, or https://x.y/b. Or (https://x.y/c) or "https://x.y/d" or https://x.y/e!',
      ),
    ).toBe(
      'Visit [https://x.y/a], or [https://x.y/b]. Or ([https://x.y/c]) or "[https://x.y/d]" or [https://x.y/e]!',
    );
  });

  it('links angle-bracket autolinks by scheme and keeps the text of the others', () => {
    expect(
      jira('<mailto:a@b.c> and <a@b.c> and <ftp://f.example/x> and <irc://x> and <foo:bar>'),
    ).toBe(
      '[mailto:a@b.c] and [a@b.c|mailto:a@b.c] and [ftp://f.example/x] and irc://x and foo:bar',
    );
  });

  it('leaves marker characters in a link target alone, and escapes them in an autolink text only where they pair', () => {
    expect(jira('[t](https://x.y/a_b_/c_d) [t](https://x.y/*a*/b*) [t](https://x.y/~u/x~)')).toBe(
      '[t|https://x.y/a_b_/c_d] [t|https://x.y/*a*/b*] [t|https://x.y/~u/x~]',
    );
    expect(
      jira('[t](https://x.y/(x)/(y)) [t](https://x.y/a--b--c) [t](https://x.y/?q=a+b+c&r=-1-)'),
    ).toBe('[t|https://x.y/(x)/(y)] [t|https://x.y/a--b--c] [t|https://x.y/?q=a+b+c&r=-1-]');
    expect(jira('https://x.y/a_b_c https://x.y/a*b*c')).toBe(
      '[https://x.y/a_b_c] [https://x.y/a*b*c]',
    );
    expect(jira('<https://x.y/*a*/b*> and <https://x.y/~u/x~>')).toBe(
      r`[https://x.y/\*a*/b*|https://x.y/*a*/b*] and [https://x.y/\~u/x~|https://x.y/~u/x~]`,
    );
  });

  it('percent-encodes braces, pipes and brackets in autolinks and keeps already encoded or non-ASCII targets', () => {
    expect(jira('<https://x.y/{a}> and http://x.y/{x} and https://x.y/a|b')).toBe(
      '[https://x.y/%7Ba%7D] and [http://x.y/%7Bx%7D] and [https://x.y/a%7Cb]',
    );
    expect(
      jira('[a](https://x.y/%E2%9C%93) [b](https://x.y/✓) [c](https://xn--n3h.example/日本)'),
    ).toBe('[a|https://x.y/%E2%9C%93] [b|https://x.y/✓] [c|https://xn--n3h.example/日本]');
    expect(jira('[t](https://x.y/a#frag|x)')).toBe('[t|https://x.y/a#frag%7Cx]');
  });

  it('keeps the case of a scheme, drops the title and the spaces around the destination', () => {
    expect(jira('[a](HTTPS://X.Y/Z) [b](Mailto:a@b.c) [c](  https://x.y  )')).toBe(
      '[a|HTTPS://X.Y/Z] [b|Mailto:a@b.c] [c|https://x.y]',
    );
    expect(jira('[a](https://x.y "title") [b](<https://x.y/a b> "t")')).toBe(
      '[a|https://x.y] [b|https://x.y/a%20b]',
    );
  });

  it('writes adjacent links and links inside words without separators', () => {
    expect(jira('[a](https://x.y) [b](https://x.y)')).toBe('[a|https://x.y] [b|https://x.y]');
    expect(jira('x[a](https://x.y)y')).toBe('x[a|https://x.y]y');
  });

  it('writes a link whose text is its URL once and links a bare e-mail address', () => {
    expect(jira('[https://x.y](https://x.y)')).toBe('[https://x.y]');
    expect(jira('[https://x.y/a](https://x.y/b)')).toBe('[https://x.y/a|https://x.y/b]');
    expect(jira('a@b.c and x_y@z.com and -a@b.c-')).toBe(
      r`[a@b.c|mailto:a@b.c] and [x_y@z.com|mailto:x_y@z.com] and \-a@b.c-`,
    );
  });

  it('resolves reference labels ignoring case and inner whitespace and drops unused definitions', () => {
    expect(jira('[a][r] [b][R] [c][ r ]\n\n[R]: https://x.y/upper')).toBe(
      '[a|https://x.y/upper] [b|https://x.y/upper] [c|https://x.y/upper]',
    );
    expect(jira('[a]: https://x.y/unused\n\ntext')).toBe('text');
    expect(jira('[a]\n\n[a]: <https://x.y/a b>')).toBe('[a|https://x.y/a%20b]');
  });

  it('keeps footnote references and effects in link text', () => {
    expect(jira('[a[^1]](https://x.y)\n\n[^1]: n')).toBe('[a¹|https://x.y]\n\n----\n\n# n');
    expect(jira('[*a* **b**](https://x.y)')).toBe('[_a_ *b*|https://x.y]');
  });
});

describe('markdownToJira: images, more', () => {
  it('keeps query strings, parentheses and underscores in an image URL', () => {
    expect(jira('![a](https://x.y/i.png?w=1&h=2)')).toBe('!https://x.y/i.png?w=1&h=2|alt=a!');
    expect(jira('![a b c](https://x.y/a(b).png)')).toBe('!https://x.y/a(b).png|alt=a b c!');
    expect(jira('![x](https://x.y/a_b_c.png) text _em_')).toBe(
      '!https://x.y/a_b_c.png|alt=x! text _em_',
    );
    expect(jira('![i](https://x.y/i.png#frag)')).toBe('!https://x.y/i.png#frag|alt=i!');
    expect(jira('![i](https://x.y/i.png "title")')).toBe('!https://x.y/i.png|alt=i!');
  });

  it('writes the plain text of an alt that has effects and keeps its quotes, dashes and colons', () => {
    expect(jira('![**bold** alt](https://x.y/i.png)')).toBe('!https://x.y/i.png|alt=bold alt!');
    expect(jira('![alt *star* ~~strike~~](https://x.y/i.png)')).toBe(
      '!https://x.y/i.png|alt=alt star strike!',
    );
    expect(jira('![alt with "quotes" and \'apos\' and (parens)](https://x.y/i.png)')).toBe(
      '!https://x.y/i.png|alt=alt with "quotes" and \'apos\' and (parens)!',
    );
    expect(jira('![alt - dash: x](https://x.y/i.png)')).toBe(
      '!https://x.y/i.png|alt=alt - dash: x!',
    );
  });

  it('writes adjacent images, an image in a list item and an image in a table cell', () => {
    expect(jira('![](https://x.y/i.png)![](https://x.y/j.png)')).toBe(
      '!https://x.y/i.png!!https://x.y/j.png!',
    );
    expect(jira('- ![i](https://x.y/i.png)\n- ![j](./a.png)')).toBe(
      '* !https://x.y/i.png|alt=i!\n* j',
    );
    expect(jira('| ![i](https://x.y/i.png) text |\n|---|\n| x |')).toBe(
      '||!https://x.y/i.png! text||\n|x|',
    );
  });

  it('leaves a `!` that ends a sentence alone next to an image', () => {
    expect(jira('Look! ![i](https://x.y/i.png) wow!')).toBe('Look! !https://x.y/i.png|alt=i! wow!');
  });
});

describe('markdownToJira: lists, more', () => {
  it('nests ordered and unordered lists four levels deep with mixed markers', () => {
    expect(jira('1. a\n   1. b\n      1. c\n         1. d')).toBe('# a\n## b\n### c\n#### d');
    expect(jira('- a\n  1. b\n     - c\n       1. d\n          - e')).toBe(
      '* a\n*# b\n*#* c\n*#*# d\n*#*#* e',
    );
    expect(jira('- [ ] a\n  - [x] b\n    - [ ] c\n- [x] d')).toBe('* ☐ a\n** ☑ b\n*** ☐ c\n* ☑ d');
  });

  it('starts every ordered list at #, whatever its number or delimiter', () => {
    expect(jira('2. starts at two\n3. three')).toBe('# starts at two\n# three');
    expect(jira('0. zero')).toBe('# zero');
    expect(jira('1) paren style\n2) second')).toBe('# paren style\n# second');
    expect(jira('1. a\n\n\n2. b')).toBe('# a\n# b');
  });

  it('ends a paragraph at a list that follows it without a blank line', () => {
    expect(jira('para\n- list\n\n1. ordered')).toBe('para\n\n* list\n\n# ordered');
  });

  it('splits lists at a comment between them and keeps separate lists apart', () => {
    expect(jira('- a\n<!-- sep -->\n- b')).toBe('* a\n\n* b');
    expect(jira('- a\n\n<!-- sep -->\n\n- b')).toBe('* a\n\n* b');
  });

  it('writes effects, code and links in items', () => {
    expect(jira('- *a*\n- **b**\n- `c`\n- [d](https://x.y)')).toBe(
      '* _a_\n* *b*\n* {{c}}\n* [d|https://x.y]',
    );
  });

  it('writes code, quotes and nested lists of an item without blank lines', () => {
    expect(jira('- a\n\n  ```js\n  x\n  ```\n\n  > q\n\n  1. n\n- b')).toBe(
      '* a\n{code:javascript}\nx\n{code}\n{quote}\nq\n{quote}\n*# n\n* b',
    );
    expect(jira('- a\n\n      indented code\n- b')).toBe(
      '* a\n{noformat}\nindented code\n{noformat}\n* b',
    );
    expect(jira('- a\n  - b\n\n  c\n- d')).toBe('* a\n** b\nc\n* d');
    expect(jira('* a\n\n  b\n* c\n\n  d')).toBe('* a\nb\n* c\nd');
  });

  it('keeps a marker-only item and consecutive empty items as no-break-space items', () => {
    expect(jira('- a\n- \n- b')).toBe(`* a\n* ${NBSP}\n* b`);
    expect(jira('* \n* ')).toBe(`* ${NBSP}\n* ${NBSP}`);
    expect(jira('1. ')).toBe(`# ${NBSP}`);
    expect(jira('-    spaced')).toBe('* spaced');
    expect(jira('- \n  text on next line')).toBe('* text on next line');
  });

  it('keeps `[x]` without text as text and a task marker glued to a word', () => {
    expect(jira('- [x]')).toBe(r`* \[x]`);
    expect(jira('- [ ]x')).toBe(r`* \[ ]x`);
    expect(jira('- [x] **bold** [link](https://x.y) `code`')).toBe(
      '* ☑ *bold* [link|https://x.y] {{code}}',
    );
    expect(jira('- [ ] a\\\n  b')).toBe('* ☐ a\nb');
  });

  it('hoists a table of a deeper item out of the list and resumes the list at the same depth', () => {
    expect(jira('- a\n  - b\n    | x |\n    |---|\n    | 1 |\n    - c\n  - d')).toBe(
      '* a\n** b\n\n||x||\n|1|\n\n*** c\n** d',
    );
    expect(
      jira('1. a\n\n   | x |\n   |---|\n   | 1 |\n\n2. b\n\n   | y |\n   |---|\n   | 2 |\n\n3. c'),
    ).toBe('# a\n\n||x||\n|1|\n\n# b\n\n||y||\n|2|\n\n# c');
  });

  it('keeps a table inside a quote inside an item with the quote', () => {
    expect(jira('- a\n  > | x |\n  > |---|\n  > | 1 |\n- b')).toBe(
      '* a\n{quote}\n||x||\n|1|\n{quote}\n* b',
    );
  });

  it('keeps the rows a lazy line adds to a table of an item', () => {
    expect(jira('- a\n  | x |\n  |---|\n  | 1 |\n  text after table\n- b')).toBe(
      '* a\n\n||x||\n|1|\n|text after table|\n\n* b',
    );
  });

  it('turns a heading in a nested item into bold text, whatever its level', () => {
    expect(jira('- a\n  - b\n    ## Deep *x*\n- c')).toBe('* a\n** b\n*Deep _x_*\n* c');
  });
});

describe('markdownToJira: quotes and alerts, more', () => {
  it('writes lists, code, headings, rules and tables inside a quote', () => {
    expect(jira('> - a\n>   - b\n> 1. c')).toBe('{quote}\n* a\n** b\n\n# c\n{quote}');
    expect(jira('> ```\n> code\n> ```\n> text')).toBe(
      '{quote}\n{noformat}\ncode\n{noformat}\n\ntext\n{quote}',
    );
    expect(jira('> ## Head\n> text')).toBe('{quote}\nh2. Head\n\ntext\n{quote}');
    expect(jira('> a\n>\n> ---\n>\n> b')).toBe('{quote}\na\n\n----\n\nb\n{quote}');
    expect(jira('> | a | b |\n> |---|---|\n> | 1 | 2 |')).toBe('{quote}\n||a||b||\n|1|2|\n{quote}');
  });

  it('drops a quote that holds only a comment', () => {
    expect(jira('> <!-- c -->\n\ntext')).toBe('text');
  });

  it('reads an alert marker without a space after `>` and with trailing spaces', () => {
    expect(jira('>[!NOTE]\n>text')).toBe('{panel:title=Note|bgColor=#deebff}\ntext\n{panel}');
    expect(jira('> [!NOTE] \n> trailing space')).toBe(
      '{panel:title=Note|bgColor=#deebff}\ntrailing space\n{panel}',
    );
    expect(jira('> [!NOTE]  \n> hard break after marker\n> next')).toBe(
      '{panel:title=Note|bgColor=#deebff}\nhard break after marker next\n{panel}',
    );
  });

  it('keeps a quote when the marker is damaged and reads only the first marker of a quote', () => {
    expect(jira('> [!NOTE]text')).toBe('{quote}\n\\[!NOTE]text\n{quote}');
    expect(jira('> [! NOTE]\n> text')).toBe('{quote}\n\\[! NOTE] text\n{quote}');
    expect(jira('> [!NOTE ]\n> text')).toBe('{quote}\n\\[!NOTE ] text\n{quote}');
    expect(jira('> **[!NOTE]**\n> text')).toBe('{quote}\n*\\[!NOTE]* text\n{quote}');
    expect(jira('> [!NOTE]\n> a\n>\n> [!TIP]\n> b')).toBe(
      '{panel:title=Note|bgColor=#deebff}\na\n\n\\[!TIP] b\n{panel}',
    );
  });

  it('writes an alert with an empty body as an empty panel', () => {
    expect(jira('> [!NOTE]\n>')).toBe('{panel:title=Note|bgColor=#deebff}\n{panel}');
  });

  it('writes lists, code, tables, images and nested quotes inside an alert', () => {
    expect(jira('> [!NOTE]\n> - a\n> - b')).toBe(
      '{panel:title=Note|bgColor=#deebff}\n* a\n* b\n{panel}',
    );
    expect(jira('> [!NOTE]\n> ```js\n> x\n> ```')).toBe(
      '{panel:title=Note|bgColor=#deebff}\n{code:javascript}\nx\n{code}\n{panel}',
    );
    expect(jira('> [!NOTE]\n> | a | b |\n> |---|---|\n> | 1 | 2 |')).toBe(
      '{panel:title=Note|bgColor=#deebff}\n||a||b||\n|1|2|\n{panel}',
    );
    expect(jira('> [!NOTE]\n> ![i](https://x.y/i.png)')).toBe(
      '{panel:title=Note|bgColor=#deebff}\n!https://x.y/i.png|alt=i!\n{panel}',
    );
    expect(jira('> [!NOTE]\n> > nested quote')).toBe(
      '{panel:title=Note|bgColor=#deebff}\n{quote}\nnested quote\n{quote}\n{panel}',
    );
  });

  it('writes an alert inside a list item after a no-break-space item when the item has no text', () => {
    expect(jira('- > [!NOTE]\n  > x')).toBe(
      `* ${NBSP}\n{panel:title=Note|bgColor=#deebff}\nx\n{panel}`,
    );
  });
});

describe('markdownToJira: code blocks, more', () => {
  it('reads tilde fences, longer fences and an unclosed fence', () => {
    expect(jira('~~~js\nconst a = 1;\n~~~')).toBe('{code:javascript}\nconst a = 1;\n{code}');
    expect(jira('````md\n```js\nx\n```\n````')).toBe('{noformat}\n```js\nx\n```\n{noformat}');
    expect(jira('```\nunclosed fence\nstill code')).toBe(
      '{noformat}\nunclosed fence\nstill code\n{noformat}',
    );
  });

  it('takes the language from the first word of the info string only', () => {
    expect(jira('```js {1,3} title="a.js"\nx\n```')).toBe('{code:javascript}\nx\n{code}');
    expect(jira('```c++\nx\n```')).toBe('{code:c++}\nx\n{code}');
    expect(jira('```c#\nx\n```')).toBe('{code:c#}\nx\n{code}');
    expect(jira('```vb.net\nx\n```')).toBe('{code:visualbasic}\nx\n{code}');
    expect(jira('```objective-c\nx\n```')).toBe('{code:objc}\nx\n{code}');
    expect(jira('```{.python}\nx\n```')).toBe('{noformat}\nx\n{noformat}');
  });

  it('keeps blank lines and spaces around the body of a block', () => {
    expect(jira('```\n\nx\n\n```')).toBe('{noformat}\n\nx\n\n{noformat}');
    expect(jira('```\n   \n```')).toBe('{noformat}\n   \n{noformat}');
  });

  it('keeps other macros and Jira markup literally inside code', () => {
    expect(jira('```text\n{quote} and {panel} and {color:red}\n```')).toBe(
      '{noformat}\n{quote} and {panel} and {color:red}\n{noformat}',
    );
    expect(jira('```\nh1. x\n* y\n||a||b||\n[~u] !i!\n```')).toBe(
      '{noformat}\nh1. x\n* y\n||a||b||\n[~u] !i!\n{noformat}',
    );
  });

  it('switches the macro for an indented block whose body holds the closing tag', () => {
    expect(jira('    {noformat}\n    x')).toBe('{code}\n{noformat}\nx\n{code}');
  });

  it('keeps a block in a quote and a block with an empty line in an item', () => {
    expect(jira('> ```sh\n> a\n>\n> b\n> ```')).toBe(
      '{quote}\n{code:bash}\na\n\nb\n{code}\n{quote}',
    );
    expect(jira('1. a\n   ```\n   x\n\n   y\n   ```\n2. b')).toBe(
      '# a\n{noformat}\nx\n\ny\n{noformat}\n# b',
    );
  });
});

describe('jiraCodeLanguage, more', () => {
  it('reads the first word of info strings with attributes, separators and odd spacing', () => {
    expect(jiraCodeLanguage('js{1,3}')).toBe('javascript');
    expect(jiraCodeLanguage('javascript:foo.js')).toBe('javascript');
    expect(jiraCodeLanguage('ts,linenos')).toBe('javascript');
    expect(jiraCodeLanguage('tsx title="x"')).toBe('javascript');
    expect(jiraCodeLanguage('\tjs')).toBe('javascript');
    expect(jiraCodeLanguage('js\tfoo')).toBe('javascript');
    expect(jiraCodeLanguage('sql;')).toBe('sql');
  });

  it('maps shell sessions, terminals, manifests and Ruby/Handlebars families', () => {
    expect(jiraCodeLanguage('shell-session')).toBe('bash');
    expect(jiraCodeLanguage('sh-session')).toBe('bash');
    expect(jiraCodeLanguage('terminal')).toBe('bash');
    expect(jiraCodeLanguage('webmanifest')).toBe('json');
    expect(jiraCodeLanguage('gemspec')).toBe('ruby');
    expect(jiraCodeLanguage('handlebars')).toBe('html');
    expect(jiraCodeLanguage('objectivec')).toBe('objc');
    expect(jiraCodeLanguage('hpp')).toBe('c++');
    expect(jiraCodeLanguage('H')).toBe('c');
    expect(jiraCodeLanguage('kts')).toBe('java');
  });

  it('answers null for a name that only looks like one', () => {
    expect(jiraCodeLanguage('.js')).toBeNull();
    expect(jiraCodeLanguage('c++17')).toBeNull();
    expect(jiraCodeLanguage('text/x-python')).toBeNull();
  });
});

describe('markdownToJira: tables, more', () => {
  it('keeps a line break in a cell before an effect, a link, code or text', () => {
    expect(jira('| h |\n|---|\n| a<br>*b* and c<br>`d` |')).toBe(r`||h||
|a\\_b_ and c\\{{d}}|`);
    expect(jira('| h |\n|---|\n| a<br>[l](https://x.y) |')).toBe(r`||h||
|a\\[l|https://x.y]|`);
    expect(jira('| h |\n|---|\n| a<br>é |')).toBe(r`||h||
|a\\é|`);
  });

  it('uses the {*} form around intraword emphasis in a cell', () => {
    expect(jira('| a | b |\n|---|---|\n| **a**b | a**b** |')).toBe('||a||b||\n|{*}a{*}b|a{*}b{*}|');
  });

  it('escapes macros, dashes, emoticons and list markers in a cell', () => {
    expect(jira('| a | b |\n|---|---|\n| {code} | {noformat} |')).toBe(r`||a||b||
|\{code}|\{noformat}|`);
    expect(jira('| a | b |\n|---|---|\n| line1 | * not list |\n| -- | --- |')).toBe(r`||a||b||
|line1|\* not list|
|\--|\---|`);
    expect(jira('| h |\n|---|\n| :) (x) |')).toBe(r`||h||
|:\) \(x)|`);
    expect(jira('| h |\n|---|\n| -a- and -b- |\n| *a* and *b* |')).toBe(r`||h||
|\-a- and \-b-|
|_a_ and _b_|`);
  });

  it('puts a footnote reference in a cell and the note after the table', () => {
    expect(jira('| a | b |\n|---|---|\n| [x] | [^1] |\n\n[^1]: note')).toBe(
      r`||a||b||
|\[x]|¹|

----

# note`,
    );
  });

  it('writes a table with only a header row and a table whose body row is empty', () => {
    expect(jira('| a | b |\n|---|---|')).toBe('||a||b||');
    expect(jira('| a | b |\n|---|---|\n|||')).toBe('||a||b||\n| | |');
    expect(jira('|a|b|\n|-|-|\n|1|2|\n|3|')).toBe('||a||b||\n|1|2|\n|3| |');
  });

  it('keeps two tables apart and a table right after a paragraph', () => {
    expect(jira('| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |')).toBe('||a||\n|1|\n\n||b||\n|2|');
    expect(jira('text\n| a |\n|---|\n| 1 |')).toBe('text\n\n||a||\n|1|');
  });

  it('makes a table row of a delimiter-like line that follows the table', () => {
    expect(jira('| a |\n|---|\n| 1 |\n| b |\n|---|')).toBe(r`||a||
|1|
|b|
|\---|`);
  });

  it('puts the link target after link text that holds a pipe and escapes the cell pipe', () => {
    expect(jira('| h |\n|---|\n| [a\\|b](https://x.y) and [c [d] e](https://x.y) |')).toBe(r`||h||
|a\|b ([https://x.y]) and c \[d] e ([https://x.y])|`);
    expect(jira('| [a\\|b](https://x.y) |\n|---|\n| x |')).toBe(r`||a\|b ([https://x.y])||
|x|`);
    expect(jira('| h |\n|---|\n| [a](https://x.y/a\\|b) |')).toBe('||h||\n|[a|https://x.y/a%7Cb]|');
  });

  it('drops the alt text of an image in a cell, also when the alt holds a pipe', () => {
    expect(jira('| h |\n|---|\n| ![a\\|b](https://x.y/i.png) |')).toBe(
      '||h||\n|!https://x.y/i.png!|',
    );
  });
});

describe('markdownToJira: HTML, more', () => {
  it('reads <br> in any spelling as a line break', () => {
    expect(jira('a <br> b <BR/> c <br /> d')).toBe('a\nb\nc\nd');
  });

  it('keeps the text of tables, lists and paragraphs, one per line', () => {
    expect(jira('<table><tr><td>cell1</td><td>cell2</td></tr></table>')).toBe('cell1\ncell2');
    expect(jira('<ul><li>one</li><li>two</li></ul>')).toBe('one\ntwo');
    expect(jira('<p>para <b>bold {x}</b></p>')).toBe(r`para bold \{x}`);
    expect(jira('text <span>a</span><span>b</span> text')).toBe('text ab text');
  });

  it('escapes list and heading markers at the start of an HTML line', () => {
    expect(jira('<div>\n* not a list\n# not a heading\n</div>')).toBe(r`\* not a list
\# not a heading`);
    expect(jira('<pre>\ncode { here }\n</pre>')).toBe(r`code \{ here }`);
  });

  it('re-reads markdown between block tags as markdown', () => {
    expect(jira('<details><summary>S</summary>\n\n**md** inside\n\n</details>')).toBe(
      'S\n\n*md* inside',
    );
  });

  it('decodes numeric references to code points and replaces invalid ones', () => {
    expect(jira('&#0; &#xD800; &#1114112; &#128512;')).toBe('� � � 😀');
  });
});

describe('markdownToJira: footnotes, more', () => {
  it('numbers notes in the order they are first referenced, also when notes cite each other', () => {
    expect(jira('A[^1] and B[^1] and C[^2]\n\n[^1]: first\n[^2]: second with[^1] ref')).toBe(
      'A¹ and B¹ and C²\n\n----\n\n# first\n# second with¹ ref',
    );
    expect(jira('[^a]: A[^b]\n[^b]: B[^a]\n\nref[^a]')).toBe('ref¹\n\n----\n\n# A²\n# B¹');
  });

  it('writes a note with several paragraphs, a list, a quote or a table', () => {
    expect(
      jira('A[^a].\n\n[^a]: note one\n\n    second paragraph of the note\n\n    - list in note'),
    ).toBe('A¹.\n\n----\n\n# note one\nsecond paragraph of the note\n#* list in note');
    expect(jira('text[^x]\n\n[^x]: > quoted note')).toBe(
      `text¹\n\n----\n\n# ${NBSP}\n{quote}\nquoted note\n{quote}`,
    );
    expect(jira('text[^x]\n\n[^x]: | a | b |\n    |---|---|\n    | 1 | 2 |')).toBe(
      `text¹\n\n----\n\n# ${NBSP}\n\n||a||b||\n|1|2|`,
    );
  });

  it('numbers a reference inside a quote, a list item, a cell and a heading', () => {
    expect(jira('> quote with note[^n]\n\n[^n]: the note')).toBe(
      '{quote}\nquote with note¹\n{quote}\n\n----\n\n# the note',
    );
    expect(jira('- list item with note[^n]\n\n[^n]: the note')).toBe(
      '* list item with note¹\n\n----\n\n# the note',
    );
    expect(jira('| a |\n|---|\n| cell[^n] |\n\n[^n]: note')).toBe(
      '||a||\n|cell¹|\n\n----\n\n# note',
    );
  });

  it('matches labels ignoring case and keeps text that only looks like a definition', () => {
    expect(jira('a [^N] b\n\n[^n]: lower')).toBe('a ¹ b\n\n----\n\n# lower');
    expect(jira('a [^n] b\n\n[^N]: upper')).toBe('a ¹ b\n\n----\n\n# upper');
    expect(jira('text[^1] and [^1]: not a def inline\n\n[^1]: real')).toBe(
      'text¹ and ¹: not a def inline\n\n----\n\n# real',
    );
    expect(jira('a[^n]b[^n]\n\n[^n]: n')).toBe('a¹b¹\n\n----\n\n# n');
  });

  it('keeps a note with no reference after the body', () => {
    expect(jira('[^1]: defined only\n\ntext with no refs')).toBe(
      'text with no refs\n\n----\n\n# defined only',
    );
  });
});

describe('markdownToJira: the converted structure keeps all of a nested document', () => {
  // A small seeded generator of nested documents (lists, tasks, quotes, alerts, code that holds the macro tags,
  // tables, headings, HTML, links, effects). Every block holds numbered words; the output must hold every word
  // exactly once, with balanced {quote} / {panel} macros and a closing {code} / {noformat} for every opening one.
  function generate(seed: number): { md: string; words: string[] } {
    let state = seed;
    const rand = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
    const words: string[] = [];
    const word = (): string => {
      const w = `tok${words.length + 1}x`;
      words.push(w);
      return w;
    };
    const leaf = (): string =>
      pick([
        () => word(),
        () => `**${word()}**`,
        () => `${word()} and \`${word()}\``,
        () => `[${word()}](https://x.y)`,
        () => `${word()} _${word()}_`,
        () => `${word()}[^n${words.length}]`,
      ])();
    const quoteLines = (lines: string[]): string[] => lines.map((l) => (l === '' ? '>' : `> ${l}`));
    const blocks = (depth: number, inList: boolean): string[] => {
      const out: string[] = [];
      const n = 1 + Math.floor(rand() * (depth > 0 ? 2 : 3));
      for (let i = 0; i < n; i++) {
        if (i > 0) out.push('');
        out.push(...block(depth, inList));
      }
      return out;
    };
    const block = (depth: number, inList: boolean): string[] => {
      const kinds = [
        'p',
        'p',
        'h',
        'code',
        'html',
        ...(depth > 2 ? [] : ['list', 'list', ...(inList ? [] : ['quote', 'alert', 'table'])]),
      ];
      switch (pick(kinds)) {
        case 'h':
          return [`## ${leaf()}`];
        case 'list': {
          const kind = pick(['ul', 'ol', 'task']);
          const out: string[] = [];
          for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) {
            const marker =
              kind === 'ol'
                ? `${i + 1}. `
                : kind === 'task'
                  ? `- [${rand() < 0.5 ? ' ' : 'x'}] `
                  : '- ';
            const inner = blocks(depth + 1, true);
            out.push(
              ...inner.map((l, j) =>
                j === 0 ? marker + l : l === '' ? '' : ' '.repeat(marker.length) + l,
              ),
            );
          }
          return out;
        }
        case 'quote':
          return quoteLines(blocks(depth + 1, inList));
        case 'alert':
          return [
            `> [!${pick(['NOTE', 'TIP', 'WARNING'])}]`,
            ...quoteLines(blocks(depth + 1, inList)),
          ];
        case 'code':
          return [
            `\`\`\`${pick(['', 'js', 'sh', 'python', 'mermaid'])}`,
            pick([
              () => word(),
              () => `${word()}\n\n${word()}`,
              () => `${word()} {code} ${word()}`,
              () => `${word()} {noformat} ${word()}`,
              () => `${word()} {code}{noformat} ${word()}`,
            ])(),
            '```',
          ]
            .join('\n')
            .split('\n');
        case 'table':
          return [`| ${word()} | ${word()} |`, '|---|---|', `| ${leaf()} | ${word()} |`];
        case 'html':
          return [`<div>${word()}</div>`];
        default:
          return [leaf()];
      }
    };
    return { md: blocks(0, false).join('\n'), words };
  }

  it('keeps every word exactly once and every macro balanced, for 300 generated documents', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { md, words } = generate(seed);
      // note definitions for the footnote references the generator wrote
      const refs = [...md.matchAll(/\[\^(n\d+)\]/g)].map((m) => m[1]);
      const source = `${md}\n\n${refs.map((id) => `[^${id}]: note ${id}`).join('\n')}`;
      const out = jira(source);
      const found = [...out.matchAll(/tok\d+x/g)].map((m) => m[0]).sort();
      expect(found, `seed ${seed}`).toEqual([...words].sort());
      const bare = out
        .replace(/\{noformat\}[\s\S]*?\{noformat\}/g, '')
        .replace(/\{code(?::[^}]*)?\}[\s\S]*?\{code\}/g, '');
      expect((bare.match(/^\{quote\}$/gm) ?? []).length % 2, `seed ${seed} quote`).toBe(0);
      expect((bare.match(/^\{panel\}$/gm) ?? []).length, `seed ${seed} panel`).toBe(
        (bare.match(/^\{panel:/gm) ?? []).length,
      );
      expect(out, `seed ${seed}`).not.toContain('\n\n\n');
    }
  });
});
