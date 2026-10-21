---
type: Reference
title: Jira markup
description: How "Copy as JIRA Markup" turns a markdown document into Jira wiki markup (src/lib/jira-markup.ts), the mapping of every GFM element, the escaping policy and the limits of real Jira renderers.
tags: [jira, markup, copy, markdown, gfm]
generated:
  by: claude-code/ctxman-jira-markup
  at: 2026-10-21T12:00:00Z
---

# Jira markup

The Copy buttons of the okf and skill doc toolbar, the snippet Markdown panel and the Inflate preview are split buttons: the main part copies the markdown, the menu offers **Copy as JIRA Markup**, which puts the same text on the clipboard as Jira wiki markup (see [Editing](/concepts/editing.md)). The conversion is `markdownToJira(markdown)` in `src/lib/jira-markup.ts`, a PURE module that the islands and `src/scripts/shell.ts` load lazily at copy time.

The goal: what Jira shows looks like the markdown preview. The output is written for both renderers that read wiki markup today, Jira Server/DC's wiki renderer and the parser Jira Cloud runs when wiki markup is pasted into its editor. Where the two differ, the output takes the form that works in both, or the one that fails gently.

## How it works

* The markdown is parsed into an mdast tree with `mdast-util-from-markdown`, `micromark-extension-gfm` and `mdast-util-gfm` (CommonMark plus GFM: tables, strikethrough, task lists, autolink literals, footnotes). No other converter package and no HTML rendering: the module walks the tree itself.
* A leading frontmatter block is dropped (the same `---` test as the doc toolbar's plain Copy), so a whole okf file converts. CRLF and CR line endings are normalized, a BOM is dropped, tabs in text become spaces.
* Blocks are separated by one blank line; the result has no trailing newline. Empty or whitespace-only input gives an empty string.
* Inline content is first built as pieces (text, our own markup, links, effect markers) and every line is then escaped as a whole, so an escape decision sees the characters around it, ours included.

## Mapping

| Markdown | Jira | Notes |
| --- | --- | --- |
| `# Title` … `###### Title`, setext | `h1. Title` … `h6. Title` | one line: a line break inside becomes a space; an empty heading is dropped |
| paragraph | its text, blank line after | a soft line break becomes a space (docs are hard-wrapped; Jira would show the newline) |
| hard break (two spaces, `\`, `<br>`) | a newline | `\\` inside a table cell, a space in a heading or link text |
| `**strong**`, `*em*`, `~~del~~`, `~del~` | `*strong*`, `_em_`, `-del-` | nested freely; the same effect nested in itself is flattened; whitespace at the edges moves outside; an effect is closed and reopened around a line break |
| `foo**bar**baz` | `foo{*}bar{*}baz` | Jira ignores a marker that touches a letter or digit, and Cloud counts every non-ASCII character as one: the `{*}` form then |
| `` `code` `` | `{{code}}` | content escaped like text (Jira Server renders effects inside `{{ }}`), braces always; spaces at the edges go outside |
| `` `Foo`s `` | `{{Foos}}` | `{{x}}s` does not render, so a touching word moves inside the code span |
| fenced code with a known language | `{code:<lang>}` … `{code}` | body literal; languages below |
| fenced code without or with an unknown language, indented code | `{noformat}` … `{noformat}` | a bare `{code}` would highlight as Java, an unknown language shows an error box |
| `> quote` | `{quote}` … `{quote}` | several paragraphs and blocks inside; a nested quote is flattened (`{quote}` cannot nest); an empty quote is dropped |
| `> [!NOTE]` and TIP, IMPORTANT, WARNING, CAUTION | `{panel:title=Note\|bgColor=#deebff}` … `{panel}` | Jira Server has no `{info}`/`{note}`/`{warning}` macros; the colour picks Cloud's panel type (info, success, note, warning, error) and tints the Server panel |
| `- item`, `1. item`, nested | `* item`, `# item`, `** sub`, `#* sub` | markers repeat for depth and mix bullet and number; a start number cannot be expressed |
| more blocks in an item | on the lines right after the item | Jira continues an item until a blank line or the next marker, so paragraphs, code, quotes and panels stay in the item; a heading becomes bold text, a rule is dropped |
| a table in an item | the list ends, the table follows, the list resumes | a table line cannot live in a Jira list (numbering restarts after it) |
| `- [ ] todo`, `- [x] done` | `* ☐ todo`, `* ☑ done` | Jira wiki markup has no checkbox; `(x)` would be the red error icon |
| an item without text | `*` and a no-break space | a bare marker is not an item in Jira |
| table | `\|\|h\|\|h\|\|` then `\|c\|c\|` | alignment cannot be expressed; the header sets the column count (short rows padded with a space cell, extra cells dropped) |
| `[text](https://…)` | `[text\|https://…]` | http, https, ftp, ftps, sftp and mailto only; effects and code allowed in the text |
| `<https://…>`, `www.…`, `me@x.y` | `[https://…]`, `[www.…\|http://www.…]`, `[me@x.y\|mailto:me@x.y]` | an autolink whose URL Jira would read as markup (an `(x)`, `-a-`) gets the escaped URL as its text |
| link text with `[`, `]` or `\|` | the text, then ` ([url])` | Jira's link syntax cannot escape them |
| `[t](ctxman:task/x)`, `[t](./x.md)`, `[t](/x.md)`, `[t](#a)`, other schemes | `t` | cannot resolve in Jira: the text stays, the link goes |
| reference links and images | resolved through their definition | the first definition of a label wins |
| `![alt](https://…/i.png)` | `!https://…/i.png\|alt=alt!` | http(s) only; the alt text loses `,` `=` `\|` `!` brackets and braces; no `alt` inside a link or a table cell |
| `![alt](./i.png)`, `data:` images | `alt` (else the file name) | Jira cannot load them |
| `---`, `***`, `___` | `----` | |
| `Text[^1]` + `[^1]: Note` | `Text¹` … a rule, then `# Note` | superscript numbers in first-reference order; the notes follow the document as a numbered list in the same order, unreferenced notes last, nothing dropped |
| HTML | its text | comments, declarations and processing instructions go; tags are stripped; `<br>` and block-level tags (`p`, `div`, `li`, `tr`, `details`, …) break the line; entities in HTML blocks are decoded |

Code block languages are mapped onto the set Jira Server/DC knows: actionscript, ada, applescript, bash, c, c#, c++, css, erlang, go, groovy, haskell, html, java, javascript, json, lua, nyan, objc, perl, php, python, r, rainbow, ruby, scala, sql, swift, visualbasic, xml, yaml. Common aliases go to them (`ts`, `tsx`, `typescript`, `jsx`, `mjs` to javascript; `sh`, `shell`, `zsh`, `console` to bash; `yml` to yaml; `py` to python; `rb` to ruby; `cpp` to c++; `cs` to c#; `kotlin` to java; `svg` to xml; `vue`, `astro` to html; `scss` to css; dialects of SQL to sql; …; `jiraCodeLanguage` holds the table). Only the first word of the info string counts, in any case. Cloud knows fewer of these names (no bash, yaml, c#) and shows those as Java, without an error. A body that contains the macro's own closing tag (`{code}` or `{noformat}`) switches to the other macro; when it holds both, the closing tag inside is broken with a zero-width space.

## Escaping

Jira reads a lot of plain text as markup. The converter puts a `\` in front of a character only where Jira Server or Cloud could read it as markup, and leaves it alone where neither could, so snake_case names, `2 * 3 * 4`, `a - b`, `C++` and `What??` stay as written.

* `{` (macros, `{{`) and `[` (links, `[~user]` mentions) are always escaped, in text and in inline code. `}` is escaped inside inline code only, `]` never.
* Effect markers `*` `_` `-` `+` `^` `~` (and `??`, `!` for images) are escaped when they could open an effect (no letter or digit before, no space after) and a later marker on the same line could close it, or when they could close an effect of ours that is open (`**2 * 3**` becomes `*2 \* 3*`). The checks use the union of both renderers' rules, so they err on the side of an extra backslash.
* At a line start (a paragraph line, a list item, a heading, a table cell): `*`, `#` or `-` before a space (a list), `|` (a table), four dashes (a rule).
* `--` and `---` between spaces would become an en or em dash: the first dash is escaped, so the text shows what the markdown shows.
* `|` is escaped in table cells.
* Emoticons stay text: `(y)` `(n)` `(i)` `(/)` `(x)` `(!)` `(+)` `(-)` `(?)` `(on)` `(off)` `(*)` `(*r)` `(*g)` `(*b)` `(*y)` `(flag)` `(flagoff)` get `\(`; `:)` `:(` `;)` and their `-` forms get the bracket or the dash escaped.
* Jira has no escape for some text: a literal `\` (before a markup character it would escape it, and `\\` is a line break), `:P` `:p` `:D` and a line that starts with `h1.` … `h6.` or `bq.`. These get an invisible zero-width space (U+200B) in between instead, which shows nothing but stays in text copied back out of Jira.

## Limits

* Jira Cloud's paste parser does not honour `\|` inside a table cell (the cell splits there); Jira Server does. A pipe in a table cell is rare enough that the Server form wins.
* Jira Cloud's panels cannot hold a code block (Cloud moves it after the panel), and its list items flatten a `{quote}` into a paragraph.
* A paragraph that follows a nested list inside the same item joins the nested list's last item (Jira has no way back to the outer item).
* An ordered list that is split by a table, and a list whose start number is not 1, restart at 1.
* The `{*}` form of an effect whose text contains the same marker (`a**b*c**d`) is read differently by Cloud.
