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
// - Effects (*strong*, _em_, -strike-) use the `{*}x{*}` form when a marker would touch a letter or digit (Jira
//   ignores markers inside words); inline code next to a letter grows to take in that word instead (`{{x}}s` never
//   renders and Jira Server's `{{{}` form is unproven), so "`Foo`s" becomes `{{Foos}}`.
// - Code: `{code:<lang>}` only for languages Jira Server/DC knows (Cloud shows the rest as Java); any other or no
//   language is `{noformat}`. A body that contains its own closing tag switches to the other macro.
// - Lists: block content of an item stays in the item on the following lines (Jira continues an item until a
//   blank line or the next marker); a table cannot live in a list, so it ends the list and follows it. Task items
//   start with ☐ / ☑. Nested blockquotes are flattened ({quote} does not nest); GitHub alerts become panels.
// - Links: only absolute http(s), ftp(s), sftp and mailto URLs become links; `ctxman:` links, bundle-relative
//   paths and #anchors cannot resolve in Jira and keep their text only. Images: http(s) only, else the alt text.
// - Footnotes: references become superscript numbers (¹ ²) in first-reference order and the notes follow the
//   document after a rule as a numbered list; unreferenced notes are kept at the end.
// - Escaping: `\` before a character only where Jira would read it as markup (every `{` and `[`; effect markers
//   that could open and close; line-start list/heading/table/rule markers; `--`/`---` between spaces, which Jira
//   turns into dashes; emoticons such as `(x)`, `:)`; `|` in table cells). Jira has no escape for `\` itself, `:D`
//   or a line-start `h1.`/`bq.`: those get an invisible U+200B (zero-width space) instead.
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
  definitions: Map<string, Definition>;
  footnotes: Map<string, FootnoteDefinition>;
  /** Footnote identifiers in the order of their numbers (number = index + 1). */
  footnoteOrder: string[];
  /** Effect marker pairs handed out so far (pair ids). */
  pairs: number;
}

interface BlockEnv {
  /** Inside a list item: no blank lines (a blank line ends a Jira list). */
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
  for (const id of ctx.footnotes.keys()) {
    if (!ctx.footnoteOrder.includes(id)) ctx.footnoteOrder.push(id);
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
      return nonEmpty(paragraphLines(node.children, ctx).join('\n'));
    case 'heading':
      return heading(node, ctx);
    case 'thematicBreak':
      return ['----'];
    case 'blockquote':
      return blockquote(node, env, ctx);
    case 'list':
      return segBlocks(listSegs(node, '', env, ctx), env);
    case 'code':
      return [codeBlock(node)];
    case 'html':
      return nonEmpty(htmlLines(node.value).join('\n'));
    case 'table':
      return [table(node, ctx)];
    default:
      // definition and footnoteDefinition (rendered where they are used / at the end); nothing else is a block.
      return [];
  }
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

function blockquote(node: Blockquote, env: BlockEnv, ctx: Ctx): string[] {
  const alert = githubAlert(node);
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
): { title: string; bgColor: string; children: RootContent[] } | null {
  const [first, ...rest] = node.children;
  const lead = first?.type === 'paragraph' ? first.children[0] : undefined;
  const match = lead?.type === 'text' ? ALERT_MARKER.exec(lead.value) : null;
  if (!match || first?.type !== 'paragraph' || lead?.type !== 'text') return null;
  const look = ALERTS[match[1].toUpperCase()];
  const remainder: Text = { type: 'text', value: lead.value.slice(match[0].length) };
  const children = [...(remainder.value === '' ? [] : [remainder]), ...first.children.slice(1)];
  const paragraph: Paragraph = { type: 'paragraph', children };
  return { ...look, children: children.length === 0 ? rest : [paragraph, ...rest] };
}

function codeBlock(node: Code): string {
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
  const body = node.value.replace(useCode ? /\{(code)\}/gi : /\{(noformat)\}/gi, `{${ZWSP}$1}`);
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

// HTML: comments go, tags are dropped (their text stays), block-level tags and <br> break the line.
const BLOCK_TAGS =
  /^(?:address|article|aside|blockquote|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/i;

function htmlLines(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<![^>]*>|<\?[\s\S]*?\?>/g, '')
    .replace(/<\/?([A-Za-z][\w-]*)[^>]*>/g, (_, name: string) =>
      name.toLowerCase() === 'br' || BLOCK_TAGS.test(name) ? '\n' : '',
    );
  const pieces: Piece[] = decodeEntities(text)
    .split('\n')
    .flatMap((line, i) => [
      ...(i > 0 ? [BREAK] : []),
      { kind: 'text' as const, value: line.replace(/\s+/g, ' '), open: '' },
    ]);
  return finishLines(pieces);
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
      if (name !== undefined) return ENTITIES[name] ?? whole;
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
  const box = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : '';
  const out: Seg[] = [];
  let rest = item.children;
  const [first] = rest;
  if (first?.type === 'paragraph') {
    const lines = paragraphLines(first.children, ctx);
    rest = rest.slice(1);
    if (lines.length > 0) out.push(`${marker} ${box}${lines[0]}`, ...lines.slice(1));
  }
  // A marker with nothing after it is not a list item in Jira: keep the item with a no-break space.
  if (out.length === 0) out.push(`${marker} ${box.trimEnd() || NBSP}`);
  for (const node of rest) {
    if (node.type === 'list') out.push(...listSegs(node, marker, env, ctx));
    else if (node.type === 'table') out.push({ block: table(node, ctx) });
    else if (node.type === 'heading') {
      // A heading line would end the list: the heading text in bold instead.
      out.push(...paragraphLines([{ type: 'strong', children: node.children }], ctx));
    } else if (node.type !== 'thematicBreak') {
      out.push(...blocks([node], { ...env, tight: true }, ctx));
    }
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

type EffectChar = '*' | '_' | '-';

/**
 * What inline content renders to before escaping. `text` is escaped when the line is finished; `mark` is our own
 * markup whose characters still pair with text markers (an image's `!`, the `{{`/`}}` of code); `opaque` is a
 * finished link (Jira parses it on its own); a `delim` is an effect marker whose form (`*` or `{*}`) depends on
 * its neighbours; `code` is inline code until it is expanded into `{{`, text, `}}`.
 */
type Piece =
  | { kind: 'text'; value: string; open: string; code?: boolean }
  | { kind: 'code'; value: string; open: string }
  | { kind: 'mark'; value: string }
  | { kind: 'opaque'; value: string }
  | { kind: 'delim'; char: EffectChar; pair: number }
  | { kind: 'break' }
  | { kind: 'forcedBreak' };

const BREAK: Piece = { kind: 'break' };

interface Inline {
  /** Effect markers open around this content (a marker of the same kind inside is flattened). */
  open: string;
  /** Inside link text or a table cell: our markup must not contain `|`. */
  plain: boolean;
}

const INLINE: Inline = { open: '', plain: false };
const CELL: Inline = { open: '', plain: true };

function phrasing(nodes: readonly PhrasingContent[], ctx: Ctx, at: Inline): Piece[] {
  return nodes.flatMap((node) => phrase(node, ctx, at));
}

function phrase(node: PhrasingContent, ctx: Ctx, at: Inline): Piece[] {
  switch (node.type) {
    case 'text':
      return [text(node.value.replace(/[ \t]*\n[ \t]*/g, ' '), at)];
    case 'strong':
      return effect('*', node.children, ctx, at);
    case 'emphasis':
      return effect('_', node.children, ctx, at);
    case 'delete':
      return effect('-', node.children, ctx, at);
    case 'inlineCode':
      return inlineCode(node.value, at);
    case 'break':
      return [BREAK];
    case 'link':
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
    case 'html':
      return inlineHtml(node.value);
    default:
      // Node types other mdast extensions register (none of them is parsed here).
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

function effect(
  char: EffectChar,
  children: readonly PhrasingContent[],
  ctx: Ctx,
  at: Inline,
): Piece[] {
  if (at.open.includes(char)) return phrasing(children, ctx, at);
  const inner = phrasing(children, ctx, { ...at, open: at.open + char });
  // A marker pair cannot span a line break: close before every break and reopen after it.
  const out: Piece[] = [];
  let segment: Piece[] = [];
  const flush = (): void => {
    out.push(...wrap(segment, char, ctx));
    segment = [];
  };
  for (const piece of inner) {
    if (piece.kind === 'break') {
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
  const core = [...pieces];
  const lead: Piece[] = [];
  const trail: Piece[] = [];
  while (core.length > 0) {
    const first = core[0];
    if (first.kind !== 'text') break;
    const space = first.value.slice(
      0,
      first.value.length - first.value.replace(/^[ \t\n\r\f\v]+/, '').length,
    );
    if (space !== '') lead.push({ ...first, value: space });
    if (space.length < first.value.length) {
      core[0] = { ...first, value: first.value.slice(space.length) };
      break;
    }
    core.shift();
  }
  while (core.length > 0) {
    const last = core[core.length - 1];
    if (last.kind !== 'text') break;
    const space = last.value.slice(last.value.replace(/[ \t\n\r\f\v]+$/, '').length);
    if (space !== '') trail.unshift({ ...last, value: space });
    if (space.length < last.value.length) {
      core[core.length - 1] = {
        ...last,
        value: last.value.slice(0, last.value.length - space.length),
      };
      break;
    }
    core.pop();
  }
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

function link(url: string, children: readonly PhrasingContent[], ctx: Ctx, at: Inline): Piece[] {
  // ctxman:, relative bundle paths, #anchors and unknown schemes cannot resolve in Jira: keep the text.
  if (!LINK_URL.test(url)) return phrasing(children, ctx, at);
  const encoded = encodeUrl(url);
  const target = `[${encoded}]`;
  const plain = children.map(plainText).join('');
  const hasImage = children.some((c) => c.type === 'image' || c.type === 'imageReference');
  // An autolink, or no text: `[url]` shows the URL, unless Jira would read markup in it (`(x)`, `-a-`): then
  // the escaped URL is the link text.
  if (plain === url || (plain.trim() === '' && !hasImage)) {
    const shown = finishLine([{ kind: 'text', value: encoded, open: '' }], { after: '|' });
    return [{ kind: 'opaque', value: shown === encoded ? target : `[${shown}|${encoded}]` }];
  }
  // Jira's link syntax has no escape for `[`, `]` or `|` in the link text: show the text, then the link.
  if (/[[\]|]/.test(plain)) {
    return [
      ...phrasing(children, ctx, at),
      text(' (', at),
      { kind: 'opaque', value: target },
      text(')', at),
    ];
  }
  const pieces = breaksTo(phrasing(children, ctx, { open: '', plain: true }), 'space');
  return [{ kind: 'opaque', value: `[${finishLine(pieces, { after: '|' })}|${encodeUrl(url)}]` }];
}

function plainText(node: PhrasingContent): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return 'children' in node ? node.children.map(plainText).join('') : '';
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

/**
 * Inline HTML is one tag, comment, CDATA section, declaration or processing instruction (the text between tags
 * comes as ordinary text): only `<br>` shows, as a line break.
 */
function inlineHtml(html: string): Piece[] {
  return /^<br\s*\/?>$/i.test(html) ? [BREAK] : [];
}

function paragraphLines(nodes: readonly PhrasingContent[], ctx: Ctx): string[] {
  return finishLines(phrasing(nodes, ctx, INLINE));
}

function breaksTo(pieces: Piece[], mode: 'space' | 'forced'): Piece[] {
  return pieces.map((p): Piece => {
    if (p.kind !== 'break') return p;
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

/** Splits at hard breaks; each line is finished on its own (Jira reads markup line by line). No empty lines. */
function finishLines(pieces: Piece[]): string[] {
  const lines: Piece[][] = [[]];
  for (const piece of pieces) {
    if (piece.kind === 'break') lines.push([]);
    else lines[lines.length - 1].push(piece);
  }
  return lines.map((line) => finishLine(line, {})).filter((line) => line !== '');
}

/** One character of a line being finished; `text` characters may get a `\` (or a zero-width space). */
interface Cell {
  ch: string;
  src: 'text' | 'mark' | 'opaque' | 'delim' | 'forcedBreak';
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
      case 'opaque':
        for (const ch of piece.value) add(ch, piece.kind);
        break;
      case 'delim':
        add(piece.char, 'delim', false, '', piece.pair);
        break;
      default:
        // forcedBreak (breaks were split off or mapped before)
        add('\\', 'forcedBreak');
        add('\\', 'forcedBreak');
    }
  }
  return render(cells, opts);
}

function trimLine(pieces: Piece[]): Piece[] {
  const [, core] = splitOuterSpace(pieces);
  return core;
}

/**
 * Jira renders `{{code}}` only when no letter or digit touches it (and Cloud counts any non-ASCII character as a
 * letter): a word run that touches the code moves inside it ("`Foo`s" -> `{{Foos}}`).
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
      while (start > 0 && wordish(chars[start - 1]) && !/\s/u.test(chars[start - 1])) start--;
      before.value = chars.slice(0, start).join('');
      code.value = chars.slice(start).join('') + code.value;
    }
    const after = out[i + 1];
    if (after?.kind === 'text') {
      const chars = [...after.value];
      let end = 0;
      while (end < chars.length && wordish(chars[end]) && !/\s/u.test(chars[end])) end++;
      after.value = chars.slice(end).join('');
      code.value += chars.slice(0, end).join('');
    }
  }
  return out;
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

  // Effect markers (and `!` images): Jira opens one when no letter/digit precedes it and no space follows it,
  // and closes it when no letter/digit follows.
  const canOpen = (i: number): boolean =>
    !wordish(chAt(i - 1)) && chAt(i + 1) !== undefined && !asciiSpace(chAt(i + 1));
  const canClose = (j: number): boolean => !wordish(chAt(j + 1));
  const laterCloser = (i: number, ch: string): boolean => {
    for (let j = i + 2; j < n; j++) {
      const cell = cells[j];
      if (cell.ch === ch && cell.src !== 'opaque' && canClose(j)) return true;
    }
    return false;
  };

  // Line start: list (`* `, `# `, `- `), table (`|`), rule (`----`) and heading / quote (`h1.`, `bq.`) markers.
  const lead = cells.map((c) => (c.src === 'text' ? c.ch : '\u0000')).join('');
  if (/^[*#-]+[ \t]/.test(lead) || /^-{4,}(?:[ \t]|$)/.test(lead) || lead.startsWith('|'))
    escape[0] = true;
  if (/^(?:h[1-6]|bq)\./i.test(lead)) zwspBefore[0] = true;

  for (let i = 0; i < n; i++) {
    if (!isText(i)) continue;
    const cell = cells[i];
    const ch = cell.ch;
    if (ch === '{' || ch === '[' || (ch === '}' && cell.code) || (ch === '|' && opts.pipes)) {
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
      if (canOpen(i) && laterCloser(i, ch)) escape[i] = true;
      else if (canClose(i) && cell.open.includes(ch)) escape[i] = true;
    } else if (ch === '!') {
      // !image! (no word-boundary test: Jira Server's image rule may not have one)
      const next = chAt(i + 1);
      const later = cells.slice(i + 2).some((c) => c.ch === '!' && c.src !== 'opaque');
      if (next !== undefined && !asciiSpace(next) && later) escape[i] = true;
    } else if (ch === '?') {
      // ??citation??
      if (
        chAt(i + 1) === '?' &&
        !wordish(chAt(i - 1)) &&
        chAt(i + 2) !== undefined &&
        !asciiSpace(chAt(i + 2))
      ) {
        const rest = cells
          .slice(i + 3)
          .map((c) => c.ch)
          .join('');
        if (rest.includes('??')) escape[i] = true;
      }
    } else if (ch === '(') {
      // Emoticons: (y) (n) (i) (/) (x) (!) (+) (-) (?) (on) (off) (*) (*r) (flag) (flagoff) ...
      if (
        EMOTICON_PAREN.test(
          cells
            .slice(i, i + 9)
            .map((c) => c.ch)
            .join(''),
        )
      )
        escape[i] = true;
    } else if (ch === ':' || ch === ';') {
      // :) :( ;) :-) :-( ;-) :-P :-D -> escape the bracket or dash; :P :p :D have no escape.
      const next = chAt(i + 1);
      const dash = next === '-' ? 1 : 0;
      const face = chAt(i + 1 + dash);
      const faces = ch === ';' ? ')' : dash ? ')(PpD' : ')(';
      if (face !== undefined && faces.includes(face) && isText(i + 1)) escape[i + 1] = true;
      else if (
        ch === ':' &&
        'PpD'.includes(next ?? 'x') &&
        isText(i + 1) &&
        !wordish(chAt(i + 2))
      ) {
        zwspBefore[i + 1] = true;
      }
    } else if (ch === '\\') {
      // Jira has no escape for `\`: `\*` would escape and `\\` breaks the line, so keep them apart.
      const next = chAt(i + 1);
      if (next !== undefined && (ESCAPABLE.has(next) || next === '\\')) zwspBefore[i + 1] = true;
    }
  }

  // An effect pair takes the `{*}` form when a letter or digit (or a `\`, kept apart by a zero-width space)
  // touches its outside.
  const wrapped = new Set<number>();
  const firstOfPair = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (cell.src !== 'delim') continue;
    const opening = firstOfPair.get(cell.pair);
    if (opening === undefined) {
      firstOfPair.set(cell.pair, i);
      if (zwspBefore[i] || wordish(chAt(i - 1))) wrapped.add(cell.pair);
    } else if (zwspBefore[i + 1] || wordish(chAt(i + 1))) wrapped.add(cell.pair);
  }

  let out = '';
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (zwspBefore[i]) out += ZWSP;
    if (escape[i]) out += '\\';
    if (cell.src === 'delim' && wrapped.has(cell.pair)) out += `{${cell.ch}}`;
    else out += cell.ch;
    // `\\` is a forced break only when no `\` follows in the same word.
    if (cell.src === 'forcedBreak' && cells[i - 1]?.src === 'forcedBreak') {
      const word = cells
        .slice(i + 1)
        .map((c) => c.ch)
        .join('')
        .split(/\s/)[0];
      if (word.includes('\\')) out += ' ';
    }
  }
  if (zwspBefore[n]) out += ZWSP;
  return out;
}
