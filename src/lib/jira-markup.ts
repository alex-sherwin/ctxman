// PURE (no fs; browser-safe): markdown (CommonMark + GFM) -> Jira wiki markup, for "Copy as JIRA Markup".
// Lazy-imported at copy time by React islands and by src/scripts/shell.ts, so it pulls in only the micromark stack
// (mdast-util-from-markdown + micromark-extension-gfm + mdast-util-gfm; no `yaml`, no Sätteri, no HTML rendering).
//
// The output is written for BOTH Jira Server/DC's wiki renderer and Jira Cloud's wiki-markup parser
// (@atlaskit/editor-wikimarkup-transformer, used when wiki markup is pasted into Cloud). The rule: what Jira shows
// looks like the markdown preview. The full mapping table and the reasons live in
// tests/data/kb/ctxman/concepts/jira-markup.md; the decisions that deviate from the obvious mapping:
// - Soft line breaks become spaces (Jira shows a newline inside a paragraph as a line break); hard breaks become a
//   newline (`\\` inside a table cell, a space inside a heading or link text).
// - Effects (*strong*, _em_, -strike-, and +u+, ~sub~, ^sup^ from HTML) use the `{*}x{*}` form when a marker would
//   touch a letter or digit (Jira ignores markers inside words). Cloud closes a `{*}` effect at the first `*` after
//   it, so such an effect whose text holds its own marker character keeps its text without the effect (as does an
//   effect Cloud cannot keep literal: around a `[…]` holding `|` or `^`, or an escape that needs a zero-width
//   space next to inline code, which that space would break). Inline code next to a letter grows to take in that
//   word instead (`{{x}}s` never renders and Jira Server's `{{{}` form is unproven), so "`Foo`s" becomes
//   `{{Foos}}`.
// - Code: `{code:<lang>}` only for languages Jira Server/DC knows (Cloud shows the rest as Java); any other or no
//   language is `{noformat}`. A body that contains its own closing tag switches to the other macro; inside a quote
//   or panel a `{quote}` / `{panel}` in the body is broken with a zero-width space (Cloud would close there).
// - Lists: block content of an item stays in the item on the following lines (Jira continues an item until a
//   blank line or the next marker); a table cannot live in a list, so it ends the list and follows it; a heading
//   anywhere in an item becomes bold text and a rule there is dropped. Task items start with ☐ / ☑. Nested
//   blockquotes are flattened ({quote} does not nest); GitHub alerts (a real `[!TYPE]` line in the source) become
//   panels.
// - Links: only absolute http(s), ftp(s), sftp and mailto URLs become links; `ctxman:` links, bundle-relative
//   paths and #anchors cannot resolve in Jira and keep their text only. Link text Jira cannot hold (`[`, `]`, `|`,
//   an image, an odd number of `!` from three on) is written as the text, then ` ([url])`. Images: http(s) only,
//   else the alt text; a letter-like character touching an image gets a space between (Cloud shows no image then).
// - HTML: common tags map to their markup (`<a href>`, `<img>`, `<br>`, `<hr>`, `<b>`/`<strong>`, `<i>`/`<em>`,
//   `<s>`/`<del>`, `<u>`/`<ins>`, `<sub>`, `<sup>`, `<code>`/`<kbd>`/`<samp>`/`<tt>`); `<script>`, `<style>`,
//   `<template>` go with their content; any other tag (or an unbalanced one) keeps only its text.
// - Footnotes: references become superscript numbers (¹ ²) in first-reference order and the notes follow the
//   document after a rule as a numbered list; unreferenced notes are kept at the end.
// - Escaping: `\` before a character only where Jira would read it as markup (every `{` and `[`; the `}` of
//   `{quote}` / `{panel}` text, whose closer Cloud finds without reading escapes; effect markers that could open and
//   close; line-start list/heading/table/rule markers; `--`/`---` between spaces, which Jira turns into dashes;
//   emoticons such as `(x)`, `:)`; `|` in table cells). Jira has no escape for `\` itself, `:D` or a line-start
//   `h1.`/`bq.`: those get an invisible U+200B (zero-width space) instead. Cloud reads the text of an effect a
//   second time with its escapes removed, so there an escaped `{`, `[` or emoticon `(` is also followed by a
//   zero-width space, an escaped marker that could open (`*`, `!`, `??`, …) or an emoticon's face is preceded
//   by one, and effect text that starts like a list, heading, quote or rule (Cloud reads it as a line start)
//   starts with one.
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type {
  Blockquote,
  Code,
  Definition,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
  Text,
} from 'mdast';

/** Markdown (a whole okf document is fine: a leading frontmatter block is dropped) as Jira wiki markup. */
export function markdownToJira(markdown: string): string {
  const source = withoutFrontmatter(markdown.replace(/\r\n?/g, '\n'));
  if (source.trim() === '') return '';
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const ctx: Ctx = {
    source,
    definitions: new Map(),
    footnotes: new Map(),
    footnoteOrder: [],
    pairs: 0,
  };
  collectDefinitions(tree, ctx);
  const body = blocks(tree.children, TOP, ctx);
  return [...body, ...footnoteSection(ctx)].join('\n\n');
}

// ---------------------------------------------------------------- code languages

/** Jira Server/DC `{code}` languages (Cloud highlights the ones it lacks, bash, yaml, c#, as Java; no error). */
const CODE_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  actionscript: ['actionscript', 'as', 'as3'],
  ada: ['ada', 'adb', 'ads'],
  applescript: ['applescript', 'osascript'],
  bash: [
    'bash',
    'sh',
    'shell',
    'zsh',
    'ksh',
    'console',
    'shellsession',
    'shell-session',
    'sh-session',
    'terminal',
  ],
  c: ['c', 'h'],
  'c#': ['c#', 'csharp', 'cs'],
  'c++': ['c++', 'cpp', 'cc', 'cxx', 'hpp', 'hxx', 'hh'],
  css: ['css', 'scss', 'sass', 'less', 'postcss'],
  erlang: ['erlang', 'erl'],
  go: ['go', 'golang'],
  groovy: ['groovy', 'gradle'],
  haskell: ['haskell', 'hs'],
  html: ['html', 'htm', 'xhtml', 'vue', 'svelte', 'astro', 'ejs', 'erb', 'handlebars', 'hbs'],
  java: ['java', 'kotlin', 'kt', 'kts'],
  javascript: [
    'javascript',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'typescript',
    'ts',
    'tsx',
    'mts',
    'cts',
    'node',
  ],
  json: ['json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'geojson', 'webmanifest'],
  lua: ['lua'],
  nyan: ['nyan'],
  objc: ['objc', 'objective-c', 'objectivec', 'obj-c', 'mm'],
  perl: ['perl', 'pl', 'pm'],
  php: ['php', 'phtml'],
  python: ['python', 'py', 'python3', 'py3', 'pyi', 'gyp'],
  r: ['r', 'rlang'],
  rainbow: ['rainbow'],
  ruby: ['ruby', 'rb', 'gemspec', 'rake'],
  scala: ['scala'],
  sql: [
    'sql',
    'mysql',
    'mariadb',
    'pgsql',
    'postgresql',
    'postgres',
    'psql',
    'plsql',
    'sqlite',
    'tsql',
    'mssql',
  ],
  swift: ['swift'],
  visualbasic: ['visualbasic', 'vb', 'vbnet', 'vb.net', 'vbs', 'vbscript', 'vba'],
  xml: ['xml', 'svg', 'xsd', 'xsl', 'xslt', 'plist', 'rss', 'atom', 'wsdl', 'xaml'],
  yaml: ['yaml', 'yml'],
};

const LANGUAGE_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries(CODE_LANGUAGES).flatMap(([jira, aliases]) =>
    aliases.map((alias) => [alias, jira] as const),
  ),
);

/**
 * The Jira `{code}` language for a fenced code block's info string (its first word, any case), or null when Jira
 * Server/DC has no such language (the block is then a `{noformat}`).
 */
export function jiraCodeLanguage(lang: string | null | undefined): string | null {
  const word = /^[\w#+.-]+/.exec(lang?.trim() ?? '')?.[0].toLowerCase() ?? '';
  return LANGUAGE_ALIASES.get(word) ?? null;
}

// ---------------------------------------------------------------- document

interface Ctx {
  /** The markdown the tree was parsed from (node offsets point into it). */
  source: string;
  definitions: Map<string, Definition>;
  footnotes: Map<string, FootnoteDefinition>;
  /** Footnote identifiers in the order of their numbers (number = index + 1). */
  footnoteOrder: string[];
  /** Effect marker pairs handed out so far (pair ids). */
  pairs: number;
}

interface BlockEnv {
  /** Inside a list item: no blank lines (a blank line ends a Jira list), no heading or rule lines. */
  tight: boolean;
  /** Inside a {quote} / {panel}: the same macro does not nest, so a nested one is flattened. */
  quote: boolean;
  panel: boolean;
}

const TOP: BlockEnv = { tight: false, quote: false, panel: false };
const NBSP = '\u00A0';
const ZWSP = '\u200B';

function withoutFrontmatter(source: string): string {
  // The same test as frontmatter-patch.ts#stripFrontmatter (a leading `---` line up to the next `---` line),
  // without importing `yaml` into this lazily loaded module.
  const text = source.replace(/^\uFEFF/, '');
  const match = /^---[ \t]*\n(?:[^\n]*\n)*?---[ \t]*(?:\n|$)/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

function collectDefinitions(node: Nodes, ctx: Ctx): void {
  if (node.type === 'definition' && !ctx.definitions.has(node.identifier)) {
    ctx.definitions.set(node.identifier, node);
  }
  if (node.type === 'footnoteDefinition' && !ctx.footnotes.has(node.identifier)) {
    ctx.footnotes.set(node.identifier, node);
  }
  if ('children' in node) for (const child of node.children) collectDefinitions(child, ctx);
}

function footnoteNumber(identifier: string, ctx: Ctx): number {
  const index = ctx.footnoteOrder.indexOf(identifier);
  if (index !== -1) return index + 1;
  ctx.footnoteOrder.push(identifier);
  return ctx.footnoteOrder.length;
}

/** The notes after a rule, as a `#` list in number order; notes nobody references come last. */
function footnoteSection(ctx: Ctx): string[] {
  if (ctx.footnotes.size === 0) return [];
  const lines: Seg[] = [];
  const numbered = new Set(ctx.footnoteOrder);
  for (const id of ctx.footnotes.keys()) {
    if (!numbered.has(id)) ctx.footnoteOrder.push(id);
  }
  // Rendering a note can number a note it references, which is then rendered in turn.
  for (let i = 0; i < ctx.footnoteOrder.length; i++) {
    // (Every numbered identifier has a definition: GFM makes a reference only when its definition exists.)
    const children = ctx.footnotes.get(ctx.footnoteOrder[i])?.children ?? [];
    lines.push(...itemSegs({ type: 'listItem', children }, '#', TOP, ctx));
  }
  return ['----', ...segBlocks(lines)];
}

// ---------------------------------------------------------------- blocks

function blocks(nodes: readonly RootContent[], env: BlockEnv, ctx: Ctx): string[] {
  return nodes.flatMap((node) => block(node, env, ctx));
}

function block(node: RootContent, env: BlockEnv, ctx: Ctx): string[] {
  switch (node.type) {
    case 'paragraph':
      return nonEmpty(paragraphLines(node.children, env, ctx).join('\n'));
    case 'heading':
      // A heading line would end a list: in an item (also inside its quote or panel) the text in bold instead.
      return env.tight
        ? nonEmpty(
            paragraphLines([{ type: 'strong', children: node.children }], env, ctx).join('\n'),
          )
        : heading(node, ctx);
    case 'thematicBreak':
      // (a rule line would end a list too)
      return env.tight ? [] : ['----'];
    case 'blockquote':
      return blockquote(node, env, ctx);
    case 'list':
      return segBlocks(listSegs(node, '', env, ctx), env);
    case 'code':
      return [codeBlock(node, env)];
    case 'html':
      return nonEmpty(paragraphLines(htmlTree(htmlItems(node.value), true), env, ctx).join('\n'));
    case 'table':
      return [table(node, ctx)];
    default:
      // definition and footnoteDefinition (rendered where they are used / at the end); nothing else is a block.
      return [];
  }
}

/** `target.push(...items)` without the argument-count limit of a spread (an effect or element can be huge). */
function append<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

function nonEmpty(text: string): string[] {
  return text === '' ? [] : [text];
}

function heading(node: Heading, ctx: Ctx): string[] {
  const text = finishLine(breaksTo(phrasing(node.children, ctx, INLINE), 'space'), {});
  return text === '' ? [] : [`h${node.depth}. ${text}`];
}

const ALERTS: Readonly<Record<string, { title: string; bgColor: string }>> = {
  // bgColor picks the Cloud panel type (info, success, note, warning, error) and colours the Server panel.
  NOTE: { title: 'Note', bgColor: '#deebff' },
  TIP: { title: 'Tip', bgColor: '#e3fcef' },
  IMPORTANT: { title: 'Important', bgColor: '#eae6ff' },
  WARNING: { title: 'Warning', bgColor: '#fffae6' },
  CAUTION: { title: 'Caution', bgColor: '#ffebe6' },
};
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const ALERT_LINE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;

function blockquote(node: Blockquote, env: BlockEnv, ctx: Ctx): string[] {
  const alert = githubAlert(node, ctx);
  const join = env.tight ? '\n' : '\n\n';
  if (alert) {
    if (env.panel) return blocks(alert.children, env, ctx);
    const inner = blocks(alert.children, { ...env, panel: true }, ctx);
    const open = `{panel:title=${alert.title}|bgColor=${alert.bgColor}}`;
    return [[open, ...(inner.length > 0 ? [inner.join(join)] : []), '{panel}'].join('\n')];
  }
  if (env.quote) return blocks(node.children, env, ctx);
  const inner = blocks(node.children, { ...env, quote: true }, ctx);
  return inner.length === 0 ? [] : [`{quote}\n${inner.join(join)}\n{quote}`];
}

/** `> [!NOTE]` and friends: the alert's look and the blockquote's children without the marker line. */
function githubAlert(
  node: Blockquote,
  ctx: Ctx,
): { title: string; bgColor: string; children: RootContent[] } | null {
  const [first, ...rest] = node.children;
  if (first?.type !== 'paragraph') return null;
  const lead = first.children[0];
  const start = first.position?.start.offset;
  if (lead?.type !== 'text' || start === undefined) return null;
  // The marker must be the whole first line of the SOURCE: an escaped `\[!NOTE]` or a `[!NOTE]<br>` is text.
  const end = ctx.source.indexOf('\n', start);
  const line = ctx.source.slice(start, end === -1 ? undefined : end);
  const match = ALERT_LINE.test(line) ? ALERT_MARKER.exec(lead.value) : null;
  if (!match) return null;
  const look = ALERTS[match[1].toUpperCase()];
  const remainder: Text = { type: 'text', value: lead.value.slice(match[0].length) };
  const children = [...(remainder.value === '' ? [] : [remainder]), ...first.children.slice(1)];
  const paragraph: Paragraph = { type: 'paragraph', children };
  return { ...look, children: children.length === 0 ? rest : [paragraph, ...rest] };
}

function codeBlock(node: Code, env: BlockEnv): string {
  let language = jiraCodeLanguage(node.lang);
  let useCode = language !== null;
  const closesCode = /\{code\}/i.test(node.value);
  const closesNoformat = /\{noformat\}/i.test(node.value);
  // A body containing the macro's own closing tag would end the block early: use the other macro, else break
  // the tag with a zero-width space.
  if (useCode && closesCode && !closesNoformat) useCode = false;
  else if (!useCode && closesNoformat && !closesCode) {
    useCode = true;
    language = null;
  }
  const open = useCode ? (language ? `{code:${language}}` : '{code}') : '{noformat}';
  const close = useCode ? '{code}' : '{noformat}';
  let body = node.value.replace(useCode ? /\{(code)\}/gi : /\{(noformat)\}/gi, `{${ZWSP}$1}`);
  // Cloud ends a {quote} / {panel} at the first closing tag after it, inside a code block too.
  if (env.quote) body = body.replace(/\{(quote)\}/gi, `{${ZWSP}$1}`);
  if (env.panel) body = body.replace(/\{(panel)\}/gi, `{${ZWSP}$1}`);
  return body === '' ? `${open}\n${close}` : `${open}\n${body}\n${close}`;
}

function table(node: Table, ctx: Ctx): string {
  // As in GFM, the header row sets the column count: shorter rows are padded, extra cells are dropped.
  const width = node.children[0].children.length;
  return node.children
    .map((row, r) => {
      const sep = r === 0 ? '||' : '|';
      const cells = Array.from({ length: width }, (_, c) => {
        const cell = row.children[c];
        const pieces = cell ? breaksTo(phrasing(cell.children, ctx, CELL), 'forced') : [];
        return finishLine(pieces, { pipes: true, after: '|' }) || ' ';
      });
      return `${sep}${cells.join(sep)}${sep}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------- HTML

/**
 * HTML, inline (mdast gives each tag of a paragraph as its own `html` node between the text nodes) or a block (one
 * `html` node with the whole HTML), is read as tags around content: common tags become phrasing content (the
 * `jira*` node types below for what mdast has no node for); any other tag, or one without its partner, keeps only
 * its content. In a block, `<br>`, block-level tags and the source's own line breaks break the line.
 */
interface HtmlTag {
  name: string;
  close: boolean;
  selfClose: boolean;
  attrs: ReadonlyMap<string, string>;
}

type HtmlItem = { node: Phrase } | { tag: HtmlTag };

const HTML_EFFECTS: ReadonlyMap<string, EffectChar> = new Map<string, EffectChar>([
  ['b', '*'],
  ['strong', '*'],
  ['i', '_'],
  ['em', '_'],
  ['s', '-'],
  ['del', '-'],
  ['strike', '-'],
  ['u', '+'],
  ['ins', '+'],
  ['sub', '~'],
  ['sup', '^'],
]);
const HTML_CODE = new Set(['code', 'kbd', 'samp', 'tt']);
/** Elements whose content is not text to show. */
const HTML_DROP = new Set(['script', 'style', 'template']);
const BLOCK_TAGS =
  /^(?:address|article|aside|blockquote|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/;

const TAG =
  /^<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseTag(source: string): HtmlTag | null {
  const match = TAG.exec(source);
  if (!match) return null;
  const attrs = new Map<string, string>();
  for (const attr of match[3].matchAll(ATTR)) {
    const key = attr[1].toLowerCase();
    if (!attrs.has(key)) attrs.set(key, decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? ''));
  }
  return {
    name: match[2].toLowerCase(),
    close: match[1] === '/',
    selfClose: match[4] === '/',
    attrs,
  };
}

/** An HTML block as text nodes, line breaks and tags (comments, CDATA, declarations, `<?…?>`, scripts and styles go). */
function htmlItems(html: string): HtmlItem[] {
  const items: HtmlItem[] = [];
  const pushText = (raw: string): void => {
    raw.split('\n').forEach((line, k) => {
      if (k > 0) items.push({ node: { type: 'break' } });
      const value = decodeEntities(line.replace(/[ \t\r\f\v]+/g, ' '));
      if (value !== '') items.push({ node: { type: 'text', value } });
    });
  };
  const skipTo = (from: number, end: string): number => {
    const at = html.indexOf(end, from);
    return at === -1 ? html.length : at + end.length;
  };
  let text = '';
  let gt = -1;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    text += html.slice(i, lt);
    i = lt + 1;
    if (html.startsWith('<!--', lt)) i = skipTo(lt + 4, '-->');
    else if (html.startsWith('<![CDATA[', lt)) i = skipTo(lt + 9, ']]>');
    else if (html.startsWith('<?', lt)) i = skipTo(lt + 2, '?>');
    else {
      // A tag ends at the first `>` (a quoted `>` in an attribute leaves the tag as text).
      if (gt < lt) gt = html.indexOf('>', lt);
      if (gt === -1) {
        i = lt; // no tag can follow: the rest is text
        break;
      }
      if (/^<![A-Za-z]/.test(html.slice(lt, lt + 3))) {
        i = gt + 1;
        continue;
      }
      const tag = parseTag(html.slice(lt, gt + 1));
      if (!tag) {
        text += '<';
        continue;
      }
      pushText(text);
      text = '';
      i = gt + 1;
      if ((tag.name === 'script' || tag.name === 'style') && !tag.close && !tag.selfClose) {
        // Raw text up to the end tag (whatever looks like a tag in it is script or CSS).
        const endTag = new RegExp(`</${tag.name}\\s*>`, 'gi');
        endTag.lastIndex = i;
        i = endTag.exec(html) === null ? html.length : endTag.lastIndex;
        continue;
      }
      items.push({ tag });
    }
  }
  pushText(text + html.slice(i));
  return items;
}

/**
 * Pairs opening and closing tags among siblings (`blockTags`: block-level tags break the line, as in an HTML block).
 * A closing tag closes the nearest open element of its name; elements left open lose their tag, not their content.
 */
function htmlTree(items: readonly HtmlItem[], blockTags: boolean): Phrase[] {
  interface Frame {
    name: string;
    attrs: ReadonlyMap<string, string>;
    children: Phrase[];
    /** Inside an element of the same kind (`<b>` in `<strong>`, `<a>` in `<a>`): only its content counts. */
    nested: boolean;
  }
  // (Elements of one kind do not nest, so the tree stays shallow however deep the HTML is.)
  const kind = (name: string): string =>
    HTML_EFFECTS.get(name) ?? (HTML_CODE.has(name) ? 'code' : name);
  const openKinds = new Map<string, number>();
  const stack: Frame[] = [{ name: '', attrs: new Map(), children: [], nested: false }];
  const top = (): Frame => stack[stack.length - 1];
  const pop = (): Frame | undefined => {
    const frame = stack.pop();
    if (frame) openKinds.set(kind(frame.name), (openKinds.get(kind(frame.name)) ?? 1) - 1);
    return frame;
  };
  const unwind = (): void => {
    const frame = pop();
    if (frame && !HTML_DROP.has(frame.name)) append(top().children, frame.children);
  };
  for (const item of items) {
    if ('node' in item) {
      top().children.push(item.node);
      continue;
    }
    const { name, close, selfClose, attrs } = item.tag;
    if (name === 'a' || HTML_EFFECTS.has(name) || HTML_CODE.has(name) || HTML_DROP.has(name)) {
      if (!close) {
        if (selfClose) continue;
        const open = openKinds.get(kind(name)) ?? 0;
        openKinds.set(kind(name), open + 1);
        stack.push({ name, attrs, children: [], nested: open > 0 });
        continue;
      }
      let k = stack.length - 1;
      while (k > 0 && stack[k].name !== name) k--;
      if (k === 0) continue; // a closing tag without its opening tag
      while (stack.length - 1 > k) unwind();
      const frame = pop();
      if (frame?.nested) append(top().children, HTML_DROP.has(frame.name) ? [] : frame.children);
      else if (frame) append(top().children, htmlElement(frame.name, frame.attrs, frame.children));
    } else if (name === 'br') top().children.push({ type: 'break' });
    else if (name === 'hr' && !close) top().children.push({ type: 'jiraRule' });
    else if (name === 'img' && !close) {
      top().children.push({
        type: 'image',
        url: (attrs.get('src') ?? '').trim(),
        alt: attrs.get('alt') ?? '',
      });
    } else if (blockTags && BLOCK_TAGS.test(name)) top().children.push({ type: 'break' });
  }
  while (stack.length > 1) unwind();
  return stack[0].children;
}

function htmlElement(
  name: string,
  attrs: ReadonlyMap<string, string>,
  children: Phrase[],
): Phrase[] {
  const char = HTML_EFFECTS.get(name);
  if (char !== undefined) return [{ type: 'jiraEffect', char, children }];
  if (HTML_CODE.has(name)) return [{ type: 'inlineCode', value: children.map(plainText).join('') }];
  if (name === 'a') {
    const href = attrs.get('href');
    return href === undefined ? children : [{ type: 'jiraLink', url: href.trim(), children }];
  }
  return []; // script, style, template
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: NBSP,
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  times: '×',
  rarr: '→',
  larr: '←',
  laquo: '«',
  raquo: '»',
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z]\w*));/g,
    (whole, dec?: string, hex?: string, name?: string) => {
      if (name !== undefined) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : whole;
      const code = Number(dec === undefined ? `0x${hex}` : dec);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : '\uFFFD';
    },
  );
}

// ---------------------------------------------------------------- lists

/** A list line, or a block that cannot live inside a Jira list (a table), which ends the list and follows it. */
type Seg = string | { block: string };

function listSegs(list: List, prefix: string, env: BlockEnv, ctx: Ctx): Seg[] {
  const marker = prefix + (list.ordered ? '#' : '*');
  return list.children.flatMap((item) => itemSegs(item, marker, env, ctx));
}

function itemSegs(item: ListItem, marker: string, env: BlockEnv, ctx: Ctx): Seg[] {
  const inner: BlockEnv = { ...env, tight: true };
  const box = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : '';
  const out: Seg[] = [];
  let rest = item.children;
  const [first] = rest;
  if (first?.type === 'paragraph') {
    const lines = paragraphLines(first.children, inner, ctx);
    rest = rest.slice(1);
    if (lines.length > 0) out.push(`${marker} ${box}${lines[0]}`, ...lines.slice(1));
  }
  // A marker with nothing after it is not a list item in Jira: keep the item with a no-break space.
  if (out.length === 0) out.push(`${marker} ${box.trimEnd() || NBSP}`);
  for (const node of rest) {
    if (node.type === 'list') out.push(...listSegs(node, marker, env, ctx));
    else if (node.type === 'table') out.push({ block: table(node, ctx) });
    else out.push(...blocks([node], inner, ctx));
  }
  return out;
}

/** Consecutive list lines become one block; a hoisted block stands alone (tight: everything joins line by line). */
function segBlocks(segs: readonly Seg[], env: BlockEnv = TOP): string[] {
  const out: string[] = [];
  let lines: string[] = [];
  for (const seg of segs) {
    if (typeof seg === 'string') {
      lines.push(seg);
      continue;
    }
    if (lines.length > 0) out.push(lines.join('\n'));
    lines = [];
    out.push(seg.block);
  }
  if (lines.length > 0) out.push(lines.join('\n'));
  return env.tight ? [out.join('\n')] : out;
}

// ---------------------------------------------------------------- inline: pieces

type EffectChar = '*' | '_' | '-' | '+' | '~' | '^';

/** mdast phrasing content plus what HTML adds: underline / sub / sup (any effect), an `<a>` link, an `<hr>` rule. */
type Phrase =
  | PhrasingContent
  | { type: 'jiraEffect'; char: EffectChar; children: Phrase[] }
  | { type: 'jiraLink'; url: string; children: Phrase[] }
  | { type: 'jiraRule' };

/**
 * What inline content renders to before escaping. `text` is escaped when the line is finished; `mark` is our own
 * markup whose characters still pair with text markers (an image's `!`, the `{{`/`}}` of code); `opaque` is a
 * finished link (Jira parses it on its own); a `delim` is an effect marker whose form (`*` or `{*}`) depends on
 * its neighbours; `code` is inline code until it is expanded into `{{`, text, `}}`; a `rule` (`<hr>`) is a line of
 * its own.
 */
type Piece =
  | { kind: 'text'; value: string; open: string; code?: boolean }
  | { kind: 'code'; value: string; open: string }
  | { kind: 'mark'; value: string }
  | { kind: 'opaque'; value: string }
  | { kind: 'delim'; char: EffectChar; pair: number }
  | { kind: 'break' }
  | { kind: 'rule' }
  | { kind: 'forcedBreak' };

const BREAK: Piece = { kind: 'break' };
const RULE: Piece = { kind: 'rule' };

interface Inline {
  /** Effect markers open around this content (a marker of the same kind inside is flattened). */
  open: string;
  /** Inside link text or a table cell: our markup must not contain `|`. */
  plain: boolean;
}

const INLINE: Inline = { open: '', plain: false };
const CELL: Inline = { open: '', plain: true };
const LINK_TEXT: Inline = { open: '', plain: true };

function phrasing(nodes: readonly Phrase[], ctx: Ctx, at: Inline): Piece[] {
  const list = nodes.some((node) => node.type === 'html') ? inlineHtml(nodes) : nodes;
  return list.flatMap((node) => phrase(node, ctx, at));
}

/** Sibling nodes with their inline HTML tags paired up (comments, declarations and the like go). */
function inlineHtml(nodes: readonly Phrase[]): Phrase[] {
  const items: HtmlItem[] = [];
  for (const node of nodes) {
    if (node.type !== 'html') items.push({ node });
    else {
      const tag = parseTag(node.value);
      if (tag) items.push({ tag });
    }
  }
  return htmlTree(items, false);
}

function phrase(node: Phrase, ctx: Ctx, at: Inline): Piece[] {
  switch (node.type) {
    case 'text':
      return [text(node.value.replace(/[ \t]*\n[ \t]*/g, ' '), at)];
    case 'strong':
      return effect('*', node.children, ctx, at);
    case 'emphasis':
      return effect('_', node.children, ctx, at);
    case 'delete':
      return effect('-', node.children, ctx, at);
    case 'jiraEffect':
      return effect(node.char, node.children, ctx, at);
    case 'inlineCode':
      return inlineCode(node.value, at);
    case 'break':
      return [BREAK];
    case 'jiraRule':
      return [RULE];
    case 'link':
    case 'jiraLink':
      return link(node.url, node.children, ctx, at);
    case 'linkReference':
      return link(ctx.definitions.get(node.identifier)?.url ?? '', node.children, ctx, at);
    case 'image':
      return image(node.url, node.alt ?? '', at);
    case 'imageReference':
      return image(ctx.definitions.get(node.identifier)?.url ?? '', node.alt ?? '', at);
    case 'footnoteReference':
      // (GFM makes a reference only when its definition exists.)
      return [text(superscript(footnoteNumber(node.identifier, ctx)), at)];
    default:
      // html (paired up in phrasing) and node types other mdast extensions register (none of them is parsed here).
      return [];
  }
}

function text(value: string, at: Inline): Piece {
  return { kind: 'text', value: value.replaceAll('\t', ' '), open: at.open };
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => SUPERSCRIPT_DIGITS[Number(d)]);
}

function effect(char: EffectChar, children: readonly Phrase[], ctx: Ctx, at: Inline): Piece[] {
  if (at.open.includes(char)) return phrasing(children, ctx, at);
  const inner = phrasing(children, ctx, { ...at, open: at.open + char });
  // A marker pair cannot span a line break: close before every break (or rule) and reopen after it.
  const out: Piece[] = [];
  let segment: Piece[] = [];
  const flush = (): void => {
    append(out, wrap(segment, char, ctx));
    segment = [];
  };
  for (const piece of inner) {
    if (piece.kind === 'break' || piece.kind === 'rule') {
      flush();
      out.push(piece);
    } else segment.push(piece);
  }
  flush();
  return out;
}

/** `segment` between a marker pair; whitespace at either end moves outside (Jira needs no space inside). */
function wrap(segment: Piece[], char: EffectChar, ctx: Ctx): Piece[] {
  const [lead, core, trail] = splitOuterSpace(segment);
  if (core.length === 0) return segment;
  const pair = ctx.pairs++;
  return [...lead, { kind: 'delim', char, pair }, ...core, { kind: 'delim', char, pair }, ...trail];
}

function splitOuterSpace(pieces: Piece[]): [Piece[], Piece[], Piece[]] {
  let from = 0;
  let to = pieces.length;
  const lead: Piece[] = [];
  const trail: Piece[] = [];
  let first: Piece | undefined;
  while (from < to) {
    const piece = pieces[from];
    if (piece.kind !== 'text') break;
    const space = piece.value.slice(
      0,
      piece.value.length - piece.value.replace(/^[ \t\n\r\f\v]+/, '').length,
    );
    if (space !== '') lead.push({ ...piece, value: space });
    if (space.length < piece.value.length) {
      first = { ...piece, value: piece.value.slice(space.length) };
      break;
    }
    from++;
  }
  let last: Piece | undefined;
  while (from < to) {
    const piece = to - 1 === from && first ? first : pieces[to - 1];
    if (piece.kind !== 'text') break;
    const space = piece.value.slice(piece.value.replace(/[ \t\n\r\f\v]+$/, '').length);
    if (space !== '') trail.unshift({ ...piece, value: space });
    if (space.length < piece.value.length) {
      last = { ...piece, value: piece.value.slice(0, piece.value.length - space.length) };
      break;
    }
    to--;
  }
  const core = pieces.slice(from, to);
  if (first && core.length > 0) core[0] = first;
  if (last && core.length > 0) core[core.length - 1] = last;
  return [lead, core, trail];
}

function inlineCode(value: string, at: Inline): Piece[] {
  // Jira opens `{{` only before a non-space and closes `}}` only after one: edge spaces go outside.
  const flat = value.replace(/\n/g, ' ');
  const code = flat.replace(/^[ \t]+|[ \t]+$/g, '');
  if (code === '') return [text(flat, at)];
  const start = flat.indexOf(code);
  const before = flat.slice(0, start);
  const after = flat.slice(start + code.length);
  return [
    ...(before === '' ? [] : [text(before, at)]),
    { kind: 'code', value: code, open: at.open },
    ...(after === '' ? [] : [text(after, at)]),
  ];
}

const LINK_URL = /^(?:(?:https?|ftps?|sftp):\/\/|mailto:)/i;
const IMAGE_URL = /^https?:\/\//i;

function link(url: string, children: readonly Phrase[], ctx: Ctx, at: Inline): Piece[] {
  // ctxman:, relative bundle paths, #anchors and unknown schemes cannot resolve in Jira: keep the text.
  if (!LINK_URL.test(url)) return phrasing(children, ctx, at);
  const encoded = encodeUrl(url);
  const target = `[${encoded}]`;
  const plain = children.map(plainText).join('');
  const hasImage = children.some((child) => someImage(child, ctx, true));
  // An autolink, or no text (an image Jira cannot show is its alt text): `[url]` shows the URL, unless Jira
  // would read markup in it (`(x)`, `-a-`): then the escaped URL is the link text.
  const noText = plain.trim() === '' && !children.some((child) => someImage(child, ctx, false));
  if (!hasImage && (plain === url || noText)) {
    const shown = finishLine([{ kind: 'text', value: encoded, open: '' }], { after: '|' });
    return [{ kind: 'opaque', value: shown === encoded ? target : `[${shown}|${encoded}]` }];
  }
  // Link text Jira cannot hold is shown as it is, then the link: its syntax has no escape for `[`, `]` or `|`,
  // and Cloud shows an image in link text on its own with the `!…!` as the link text (README badges).
  const textThenLink = (): Piece[] => [
    ...phrasing(children, ctx, at),
    text(' (', at),
    { kind: 'opaque', value: target },
    text(')', at),
  ];
  if (hasImage || /[[\]|]/.test(plain)) return textThenLink();
  const shown = finishLine(breaksTo(phrasing(children, ctx, LINK_TEXT), 'space'), { after: '|' });
  // Jira reads the `!`s before the `|` as image markers: an odd number from three on hides the `|` (the whole
  // link stays text).
  let bangs = 0;
  for (const ch of shown) if (ch === '!') bangs++;
  if (bangs >= 3 && bangs % 2 === 1) return textThenLink();
  return [{ kind: 'opaque', value: `[${shown}|${encoded}]` }];
}

/** An image (also nested in an effect); `shown`: only one that renders as an image (an http(s) URL). */
function someImage(node: Phrase, ctx: Ctx, shown: boolean): boolean {
  if (node.type === 'image') return !shown || IMAGE_URL.test(node.url);
  if (node.type === 'imageReference') {
    return !shown || IMAGE_URL.test(ctx.definitions.get(node.identifier)?.url ?? '');
  }
  if (!('children' in node)) return false;
  const children: readonly Phrase[] = node.children;
  return children.some((child) => someImage(child, ctx, shown));
}

function plainText(node: Phrase): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return ' ';
  if (!('children' in node)) return '';
  const children: readonly Phrase[] = node.children;
  return children.map(plainText).join('');
}

/** Percent-encodes what Jira would read inside `[…]` / `!…!` (and whitespace). */
function encodeUrl(url: string): string {
  return url.replace(
    /[\s|[\]{}^!\\]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

function image(url: string, alt: string, at: Inline): Piece[] {
  if (IMAGE_URL.test(url)) {
    const altText = at.plain
      ? ''
      : alt
          .replace(/[|!,=[\]{}]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
    return [{ kind: 'mark', value: `!${encodeUrl(url)}${altText ? `|alt=${altText}` : ''}!` }];
  }
  // A bundle-relative or data: image cannot be shown in Jira: its alt text, else its file name.
  const name = alt.trim() || (/^data:/i.test(url) ? '' : fileName(url));
  return name === '' ? [] : [text(name, at)];
}

function fileName(url: string): string {
  const path = url.replace(/[?#].*$/s, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Paragraph content as lines; in a list item (`env.tight`) an `<hr>` rule is no line of its own (it would end the list). */
function paragraphLines(nodes: readonly Phrase[], env: BlockEnv, ctx: Ctx): string[] {
  return finishLines(phrasing(nodes, ctx, INLINE), !env.tight);
}

function breaksTo(pieces: Piece[], mode: 'space' | 'forced'): Piece[] {
  return pieces.map((p): Piece => {
    if (p.kind !== 'break' && p.kind !== 'rule') return p;
    return mode === 'space' ? { kind: 'text', value: ' ', open: '' } : { kind: 'forcedBreak' };
  });
}

// ---------------------------------------------------------------- inline: finishing a line

interface LineOpts {
  /** Escape every `|` (table cells). */
  pipes?: boolean;
  /** The character that follows this content in the output (`|` after a cell or link text), '' = none. */
  after?: string;
}

/**
 * Splits at hard breaks (and rules, which become a `----` line when `rules`, else a break); each line is finished
 * on its own (Jira reads markup line by line). No empty lines.
 */
function finishLines(pieces: Piece[], rules: boolean): string[] {
  const lines: Piece[][] = [[]];
  const ruleLines = new Set<number>();
  for (const piece of pieces) {
    if (piece.kind === 'break') lines.push([]);
    else if (piece.kind === 'rule') {
      if (rules) {
        ruleLines.add(lines.length);
        lines.push([]);
      }
      lines.push([]);
    } else lines[lines.length - 1].push(piece);
  }
  return lines
    .map((line, i) => (ruleLines.has(i) ? '----' : finishLine(line, {})))
    .filter((line) => line !== '');
}

/** One character of a line being finished; `text` characters may get a `\` (or a zero-width space). */
interface Cell {
  ch: string;
  /** `forcedBreak` / `forcedBreakEnd`: the first / second `\` of a `\\` line break. */
  src: 'text' | 'mark' | 'opaque' | 'delim' | 'forcedBreak' | 'forcedBreakEnd';
  /** The first / last `!` of an image. */
  image?: 'open' | 'close';
  code: boolean;
  open: string;
  pair: number;
}

const ESCAPABLE = new Set('-#*_+?^~|%{}[]()!@');
const EFFECT_CHARS = new Set('*_-+^~');
const EMOTICON_PAREN = /^\((?:[yni/x!+\-?*]|on|off|\*[rgby]|flag|flagoff)\)/;

function finishLine(raw: Piece[], opts: LineOpts): string {
  const pieces = absorbIntoCode(trimLine(raw));
  const cells: Cell[] = [];
  for (const piece of pieces) {
    const add = (ch: string, src: Cell['src'], code = false, open = '', pair = -1): void => {
      cells.push({ ch, src, code, open, pair });
    };
    switch (piece.kind) {
      case 'text':
        for (const ch of piece.value) add(ch, 'text', piece.code === true, piece.open);
        break;
      case 'code':
        add('{', 'mark');
        add('{', 'mark');
        for (const ch of piece.value) add(ch, 'text', true, piece.open);
        add('}', 'mark');
        add('}', 'mark');
        break;
      case 'mark':
      case 'opaque': {
        const first = cells.length;
        for (const ch of piece.value) add(ch, piece.kind);
        if (piece.kind === 'mark' && piece.value.startsWith('!')) {
          cells[first].image = 'open';
          cells[cells.length - 1].image = 'close';
        }
        break;
      }
      case 'delim':
        add(piece.char, 'delim', false, '', piece.pair);
        break;
      case 'forcedBreak':
        add('\\', 'forcedBreak');
        add('\\', 'forcedBreakEnd');
        break;
      default:
        // break and rule (split off or mapped before)
        break;
    }
  }
  return render(cells, opts);
}

/** Without the whitespace (and table-cell line breaks) at either end. */
function trimLine(pieces: Piece[]): Piece[] {
  let core = pieces;
  for (;;) {
    [, core] = splitOuterSpace(core);
    const from = core[0]?.kind === 'forcedBreak' ? 1 : 0;
    const to = core.length > from && core[core.length - 1].kind === 'forcedBreak' ? 1 : 0;
    if (from === 0 && to === 0) return core;
    core = core.slice(from, core.length - to);
  }
}

/**
 * Jira renders `{{code}}` only when no letter or digit touches it (and Cloud counts any non-ASCII character as a
 * letter, punctuation such as `—` or `“` included): a word run that touches the code moves inside it ("`Foo`s" ->
 * `{{Foos}}`).
 */
function absorbIntoCode(pieces: Piece[]): Piece[] {
  const out = pieces.map((p) => ({ ...p }));
  for (let i = 0; i < out.length; i++) {
    const code = out[i];
    if (code.kind !== 'code') continue;
    const before = out[i - 1];
    if (before?.kind === 'text') {
      const chars = [...before.value];
      let start = chars.length;
      // (a `\` too: `\{{` would escape the `{`, and a zero-width space before `{{` stops the code in Cloud)
      while (start > 0 && (absorbable(chars[start - 1]) || chars[start - 1] === '\\')) start--;
      before.value = chars.slice(0, start).join('');
      code.value = chars.slice(start).join('') + code.value;
    }
    const after = out[i + 1];
    if (after?.kind === 'text') {
      const chars = [...after.value];
      let end = 0;
      while (end < chars.length && absorbable(chars[end])) end++;
      after.value = chars.slice(end).join('');
      code.value += chars.slice(0, end).join('');
    }
  }
  return out;
}

function absorbable(ch: string): boolean {
  return wordish(ch) && !/\s/u.test(ch);
}

/** A letter or digit for Jira's marker rules: ASCII alphanumerics and (Cloud) any non-ASCII but a no-break space. */
function wordish(ch: string | undefined): boolean {
  if (ch === undefined || ch === '') return false;
  return /[A-Za-z0-9]/.test(ch) || (ch > '\x7F' && ch !== NBSP);
}

function asciiSpace(ch: string | undefined): boolean {
  return ch !== undefined && /^[ \t\n\r\f\v]$/.test(ch);
}

function render(cells: Cell[], opts: LineOpts): string {
  const n = cells.length;
  const after = opts.after ?? '';
  const chAt = (i: number): string | undefined =>
    i < 0 ? undefined : i < n ? cells[i].ch : i === n && after !== '' ? after : undefined;
  const isText = (i: number): boolean => cells[i]?.src === 'text';
  const escape = new Array<boolean>(n).fill(false);
  const zwspBefore = new Array<boolean>(n + 1).fill(false);
  // Cloud reads the text of an effect a second time with its escapes removed: an escaped character inside an
  // effect also needs a zero-width space that breaks its markup, before it (an effect marker, `!` or `??` then
  // touches a "letter"; an emoticon's face) or after it (`{`, `[`, an emoticon's `(`, a code `}` before `}`).
  const guardBefore = new Array<boolean>(n).fill(false);
  const guardAfter = new Array<boolean>(n).fill(false);

  // Effect markers (and `!` images): Jira opens one when no letter/digit precedes it and no space follows it,
  // and closes it when no letter/digit follows.
  const canOpen = (i: number): boolean =>
    !wordish(chAt(i - 1)) && chAt(i + 1) !== undefined && !asciiSpace(chAt(i + 1));
  const canClose = (j: number): boolean => !wordish(chAt(j + 1));
  // Where the next `!`, `??` or closer of a marker is (n = none), so that "a later one" stays a lookup.
  const nextWhere = (test: (j: number) => boolean): Int32Array => {
    const next = new Int32Array(n + 1).fill(n);
    for (let j = n - 1; j >= 0; j--) next[j] = test(j) ? j : next[j + 1];
    return next;
  };
  const nextAt = (next: Int32Array, from: number): number => (from >= n ? n : next[from]);
  const closers = new Map<string, Int32Array>();
  const nextCloser = (ch: string, from: number): number => {
    let next = closers.get(ch);
    if (!next) {
      next = nextWhere((j) => cells[j].ch === ch && cells[j].src !== 'opaque' && canClose(j));
      closers.set(ch, next);
    }
    return nextAt(next, from);
  };
  const bangs = nextWhere((j) => cells[j].ch === '!' && cells[j].src !== 'opaque');
  const doubleQs = nextWhere((j) => cells[j].ch === '?' && cells[j + 1]?.ch === '?');
  // The closing marker of the outermost effect around each cell (-1 = none): Cloud re-reads the text up to it.
  const pairEnd = new Map<number, number>();
  for (let i = 0; i < n; i++) if (cells[i].src === 'delim') pairEnd.set(cells[i].pair, i);
  const outerEnd = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (cells[i].src !== 'delim') continue;
    const end = pairEnd.get(cells[i].pair) ?? i;
    for (let j = i + 1; j < end; j++) outerEnd[j] = end;
    i = end;
  }
  const charsAt = (from: number, to: number): string =>
    cells
      .slice(Math.max(from, 0), to)
      .map((c) => c.ch)
      .join('');

  // Line start: list (`* `, `# `, `- `), table (`|`), rule (`----`) and heading / quote (`h1.`, `bq.`) markers.
  const textAt = (i: number): string => (isText(i) ? cells[i].ch : i < n ? '\u0000' : '');
  let markers = 0;
  while (textAt(markers) !== '' && '*#-'.includes(textAt(markers))) markers++;
  let dashes = 0;
  while (textAt(dashes) === '-') dashes++;
  const blankAt = (i: number): boolean => textAt(i) === ' ' || textAt(i) === '\t';
  if (
    (markers > 0 && blankAt(markers)) ||
    (dashes >= 4 && (dashes === n || blankAt(dashes))) ||
    textAt(0) === '|'
  ) {
    escape[0] = true;
  }
  if (/^(?:h[1-6]|bq)\./i.test(textAt(0) + textAt(1) + textAt(2))) zwspBefore[0] = true;

  for (let i = 0; i < n; i++) {
    if (!isText(i)) continue;
    const cell = cells[i];
    const ch = cell.ch;
    if (ch === '{' || ch === '[') {
      escape[i] = true;
      guardAfter[i] = true;
    } else if (ch === '}' && (cell.code || /^\{(?:quote|panel)$/i.test(charsAt(i - 6, i)))) {
      // (Cloud ends a {quote} / {panel} at the next `{quote}` / `{panel}` without reading escapes.)
      escape[i] = true;
      if (chAt(i + 1) === '}') guardAfter[i] = true;
    } else if (ch === '|' && opts.pipes) {
      escape[i] = true;
    } else if (EFFECT_CHARS.has(ch)) {
      if (ch === '-' && chAt(i - 1) !== '-') {
        // `--` / `---` between spaces become en / em dashes.
        // (Jira reads a cell or link text on its own, so its end is a line end here.)
        let end = i;
        while (end < n && isText(end) && cells[end].ch === '-') end++;
        const length = end - i;
        const spaced = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
        if ((length === 2 || length === 3) && spaced(chAt(i - 1)) && spaced(cells[end]?.ch)) {
          escape[i] = true;
        }
      }
      const closer = canOpen(i) ? nextCloser(ch, i + 2) : n;
      if (closer < n) {
        escape[i] = true;
        // (re-read inside an effect, it opens only with a closer inside that effect)
        if (closer < outerEnd[i]) guardBefore[i] = true;
      } else if (canClose(i) && cell.open.includes(ch)) escape[i] = true;
    } else if (ch === '!') {
      // !image! (no word-boundary test: Jira Server's image rule may not have one)
      const next = chAt(i + 1);
      const bang = nextAt(bangs, i + 2);
      if (next !== undefined && !asciiSpace(next) && bang < n) {
        escape[i] = true;
        if (bang < outerEnd[i]) guardBefore[i] = true;
      }
    } else if (ch === '?') {
      // ??citation??
      const third = chAt(i + 2);
      const closing = nextAt(doubleQs, i + 3);
      if (
        chAt(i + 1) === '?' &&
        !wordish(chAt(i - 1)) &&
        third !== undefined &&
        !asciiSpace(third) &&
        closing < n
      ) {
        escape[i] = true;
        if (closing + 1 < outerEnd[i]) guardBefore[i] = true;
      }
    } else if (ch === '(') {
      // Emoticons: (y) (n) (i) (/) (x) (!) (+) (-) (?) (on) (off) (*) (*r) (flag) (flagoff) ...
      if (EMOTICON_PAREN.test(charsAt(i, i + 9))) {
        escape[i] = true;
        guardAfter[i] = true;
      }
    } else if (ch === ':' || ch === ';') {
      // :) :( ;) :-) :-( ;-) :-P :-D -> escape the bracket or dash; :P :p :D have no escape.
      const next = chAt(i + 1);
      const dash = next === '-' ? 1 : 0;
      const face = chAt(i + 1 + dash);
      const faces = ch === ';' ? ')' : dash ? ')(PpD' : ')(';
      if (face !== undefined && faces.includes(face) && isText(i + 1)) {
        escape[i + 1] = true;
        guardBefore[i + 1] = true;
      } else if (
        ch === ':' &&
        'PpD'.includes(next ?? 'x') &&
        isText(i + 1) &&
        !/[A-Za-z0-9]/.test(chAt(i + 2) ?? '')
      ) {
        // (Cloud takes `:P` as an emoticon before anything but an ASCII letter or digit.)
        zwspBefore[i + 1] = true;
      }
    } else if (ch === '\\') {
      // Jira has no escape for `\`: `\*` would escape and `\\` breaks the line, so keep them apart.
      const next = chAt(i + 1);
      if (next !== undefined && (ESCAPABLE.has(next) || next === '\\')) zwspBefore[i + 1] = true;
    }
  }
  // Never before our `{{` or after our `}}` (Cloud would not read the code then): where such a space is needed,
  // the effects around lose their markers instead (below). None before an image either, which ends any `[…]` or
  // emoticon anyway; after an image the space added below keeps the image apart.
  const unguarded = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (!escape[i] || outerEnd[i] === -1) continue;
    const prev = cells[i - 1];
    const next = cells[i + 1];
    if (guardBefore[i]) {
      if (prev?.src === 'mark' && prev.ch === '}') unguarded.add(i);
      else zwspBefore[i] = true;
    }
    if (guardAfter[i]) {
      if (next?.src === 'mark' && next.ch === '{') {
        if (cells[i].ch === '{') unguarded.add(i);
      } else if (next?.image !== 'open') zwspBefore[i + 1] = true;
    }
  }
  // Cloud also re-reads an effect's text as the start of a line: a list, heading, quote or rule marker there
  // (escaped or not) gets a zero-width space first.
  const opened = new Set<number>();
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (cell.src !== 'delim' || opened.has(cell.pair)) continue;
    opened.add(cell.pair);
    if (/^(?:bq\.|h[1-6]\.|-{4}|[*#]+ |- )/i.test(charsAt(i + 1, i + 24))) zwspBefore[i + 1] = true;
  }

  // A literal `[…]` holding `|` or `^` cannot stay text inside an effect in Cloud (re-read without escapes it is
  // a link or an attachment, a zero-width space does not help): such brackets, as [start, end] cell spans.
  const brackets: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!isText(i) || cells[i].ch !== '[') continue;
    let j = i + 1;
    let holds = false;
    while (j < n && cells[j].ch !== ']' && cells[j].ch !== '[') {
      holds ||= cells[j].ch === '|' || cells[j].ch === '^';
      j++;
    }
    if (j < n && cells[j].ch === ']' && holds) brackets.push([i, j]);
    i = j - 1;
  }
  let nextBracket = 0;
  const holdsBracket = (from: number, to: number): boolean => {
    while (nextBracket < brackets.length && brackets[nextBracket][0] <= from) nextBracket++;
    let k = nextBracket;
    while (k < brackets.length && brackets[k][0] < to) {
      if (brackets[k][1] < to) return true;
      k++;
    }
    return false;
  };

  // An effect pair takes the `{*}` form when a letter or digit (or a `\`, kept apart by a zero-width space)
  // touches its outside. Cloud closes a `{*}` pair at the first `*` after it, so a pair of that form whose text
  // holds its own marker character loses its markers (its text stays), as does a pair around such a bracket or
  // around an escape that needs a zero-width space next to our code markup.
  const wrapped = new Set<number>();
  const dropped = new Set<number>();
  const opening = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (cell.src !== 'delim') continue;
    const start = opening.get(cell.pair);
    if (start === undefined) {
      opening.set(cell.pair, i);
      if (zwspBefore[i] || wordish(chAt(i - 1))) wrapped.add(cell.pair);
      continue;
    }
    if (zwspBefore[i + 1] || wordish(chAt(i + 1))) wrapped.add(cell.pair);
    if (wrapped.has(cell.pair)) {
      for (let j = start + 1; j < i; j++) {
        if (cells[j].ch === cell.ch) {
          dropped.add(cell.pair);
          break;
        }
      }
    }
  }
  for (const [pair, start] of opening) {
    const end = pairEnd.get(pair) ?? start;
    if (brackets.length > 0 && holdsBracket(start, end)) dropped.add(pair);
  }
  if (unguarded.size > 0) {
    const open: number[] = [];
    for (let i = 0; i < n; i++) {
      const cell = cells[i];
      if (cell.src === 'delim') {
        if (opening.get(cell.pair) === i) open.push(cell.pair);
        else open.pop();
      } else if (unguarded.has(i)) for (const pair of open) dropped.add(pair);
    }
  }

  // `\\` is a forced break only when no `\` follows in the same word (Jira: `\\(?!\S*\\)`): a space after it then.
  const backslashAhead = new Array<boolean>(n + 1).fill(false);
  for (let j = n - 1; j >= 0; j--) {
    if (asciiSpace(cells[j].ch)) continue;
    backslashAhead[j] = escape[j] || cells[j].ch === '\\' || backslashAhead[j + 1];
  }

  let out = '';
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (zwspBefore[i]) out += ZWSP;
    // Cloud shows an image only when no letter, digit or other non-ASCII character touches its `!`s: a space then.
    if (cell.image === 'open' && (zwspBefore[i] || wordish(chAt(i - 1)))) out += ' ';
    if (escape[i]) out += '\\';
    if (cell.src !== 'delim') out += cell.ch;
    else if (!dropped.has(cell.pair)) out += wrapped.has(cell.pair) ? `{${cell.ch}}` : cell.ch;
    if (cell.src === 'forcedBreakEnd' && backslashAhead[i + 1]) out += ' ';
    if (cell.image === 'close' && (zwspBefore[i + 1] || wordish(chAt(i + 1)))) out += ' ';
  }
  if (zwspBefore[n]) out += ZWSP;
  return out;
}
