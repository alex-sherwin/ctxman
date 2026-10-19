// Browser-safe (fetch via ui/edit/api.ts only inside functions; no Monaco, no React, nothing touches the DOM at
// import, so the SSR Astro components import the id helpers too): the descriptors and adapters behind the
// markdown popup editors (ROUND2_UI_SPEC §F.2). A "target" is one small markdown area of a context, recipe,
// reference or snippet yaml: a link's `notes`, a recipe's `preamble`, one `markdown` block `body`, a
// reference's `info`, or a snippet's `markdown`. The pure adapters (`readTarget` / `writeTarget` / `endpoint` /
// `hasTarget`) never mutate; `loadTarget` / `saveTarget` are the read-modify-write round trip against
// `/api/context/:slug`, `/api/recipe/:slug`, `/api/reference/:slug` and `/api/snippet/:slug`.
//
// Those PUTs have no `ifUnmodifiedSince` (unlike `/api/doc`), so `saveTarget` re-GETs right before the PUT and
// compares `lastModified` with the one the editor was opened on (D11). The PUT then carries the FRESH document
// with only this target replaced, so concurrent edits to other parts of the file are never rolled back.
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import type { RecipeData, ReferenceData, SnippetData } from '../../datasets/schemas.ts';
import type { ContextDoc } from '../../lib/entry-summary.ts';
import { getJson, sendJson } from '../edit/api.ts';

export type MdTarget =
  | {
      kind: 'context-notes';
      /** The SSR button's `data-md-edit` value: `notes:<dataset>:<slug>`. */
      id: string;
      /** The context's slug. */
      slug: string;
      /** The link's dataset and slug. */
      dataset: LinkableDatasetId;
      target: string;
      label: string;
    }
  | {
      kind: 'recipe-preamble';
      /** `preamble` */
      id: string;
      /** The recipe's slug. */
      slug: string;
      label: string;
    }
  | {
      kind: 'recipe-block';
      /** `block:<blockId>` */
      id: string;
      slug: string;
      blockId: string;
      label: string;
    }
  | {
      kind: 'reference-info';
      /** `info` */
      id: string;
      /** The reference's slug. */
      slug: string;
      label: string;
    }
  | {
      kind: 'snippet-markdown';
      /** `markdown` */
      id: string;
      /** The snippet's slug. */
      slug: string;
      label: string;
    };

// ---------------------------------------------------------------- ids shared with the SSR buttons

/** `data-md-edit` of the pencil button for a context link's notes. */
export const noteTargetId = (dataset: string, slug: string): string => `notes:${dataset}:${slug}`;
/** `data-md-edit` of the recipe preamble's pencil button. */
export const PREAMBLE_TARGET_ID = 'preamble';
/** `data-md-edit` of a recipe markdown block's pencil button. */
export const blockTargetId = (blockId: string): string => `block:${blockId}`;
/** `data-md-edit` of a reference's info pencil button. */
export const INFO_TARGET_ID = 'info';
/** `data-md-edit` of a snippet's markdown pencil button. */
export const SNIPPET_TARGET_ID = 'markdown';

/** The `MarkdownTargets` props of a context detail page: one notes target per link, in context order. */
export function contextNoteTargets(
  slug: string,
  links: readonly { dataset: LinkableDatasetId; slug: string; title?: string | undefined }[],
): MdTarget[] {
  return links.map((l) => ({
    kind: 'context-notes',
    id: noteTargetId(l.dataset, l.slug),
    slug,
    dataset: l.dataset,
    target: l.slug,
    label: `notes for ${l.title ?? l.slug}`,
  }));
}

/** The `MarkdownTargets` props of a recipe detail page: the preamble plus one target per markdown block. */
export function recipeTargets(slug: string, blocks: readonly { id: string }[]): MdTarget[] {
  return [
    { kind: 'recipe-preamble', id: PREAMBLE_TARGET_ID, slug, label: 'preamble' },
    ...blocks.map((b): MdTarget => ({
      kind: 'recipe-block',
      id: blockTargetId(b.id),
      slug,
      blockId: b.id,
      label: `markdown block ${b.id}`,
    })),
  ];
}

/** The `MarkdownTargets` props of a reference detail page: its info. */
export function referenceTargets(slug: string): MdTarget[] {
  return [{ kind: 'reference-info', id: INFO_TARGET_ID, slug, label: 'info' }];
}

/** The `MarkdownTargets` props of a snippet detail page: its markdown. */
export function snippetTargets(slug: string): MdTarget[] {
  return [{ kind: 'snippet-markdown', id: SNIPPET_TARGET_ID, slug, label: 'markdown' }];
}

/**
 * The yaml document a target lives in: a context (`links`), a recipe, a reference (`type`) or a snippet
 * (`markdown` is a string; a recipe's `markdown` is its list of blocks).
 */
export type MdDoc = ContextDoc | RecipeData | ReferenceData | SnippetData;

function isContextDoc(doc: MdDoc): doc is ContextDoc {
  return 'links' in doc;
}

function isReferenceDoc(doc: MdDoc): doc is ReferenceData {
  return 'type' in doc && 'owner' in doc;
}

function isSnippetDoc(doc: MdDoc): doc is SnippetData {
  return typeof (doc as { markdown?: unknown }).markdown === 'string';
}

function isRecipeDoc(doc: MdDoc): doc is RecipeData {
  return !isContextDoc(doc) && !isReferenceDoc(doc) && !isSnippetDoc(doc);
}

/** The API collection of a target's document. */
function collectionOf(t: MdTarget): 'context' | 'recipe' | 'reference' | 'snippet' {
  switch (t.kind) {
    case 'context-notes':
      return 'context';
    case 'reference-info':
      return 'reference';
    case 'snippet-markdown':
      return 'snippet';
    default:
      return 'recipe';
  }
}

/** `/api/context/<slug>`, `/api/recipe/<slug>`, `/api/reference/<slug>` or `/api/snippet/<slug>`. */
export function endpoint(t: MdTarget): string {
  return `/api/${collectionOf(t)}/${encodeURIComponent(t.slug)}`;
}

/** The target with the given SSR button id, or undefined. */
export function targetById(
  targets: readonly MdTarget[],
  id: string | undefined,
): MdTarget | undefined {
  return id === undefined ? undefined : targets.find((t) => t.id === id);
}

/** Does `doc` still contain the area `t` points at? (A link or block can vanish while the popup is open.) */
export function hasTarget(t: MdTarget, doc: MdDoc): boolean {
  switch (t.kind) {
    case 'context-notes':
      return (
        isContextDoc(doc) && doc.links.some((l) => l.dataset === t.dataset && l.slug === t.target)
      );
    case 'recipe-preamble':
      return isRecipeDoc(doc);
    case 'recipe-block':
      return isRecipeDoc(doc) && doc.markdown.some((b) => b.id === t.blockId);
    case 'reference-info':
      return isReferenceDoc(doc);
    case 'snippet-markdown':
      return isSnippetDoc(doc);
  }
}

/** The current text of the area (`''` when absent). */
export function readTarget(t: MdTarget, doc: MdDoc): string {
  switch (t.kind) {
    case 'context-notes':
      return isContextDoc(doc)
        ? (doc.links.find((l) => l.dataset === t.dataset && l.slug === t.target)?.notes ?? '')
        : '';
    case 'recipe-preamble':
      return isRecipeDoc(doc) ? (doc.preamble ?? '') : '';
    case 'recipe-block':
      return isRecipeDoc(doc) ? (doc.markdown.find((b) => b.id === t.blockId)?.body ?? '') : '';
    case 'reference-info':
      return isReferenceDoc(doc) ? (doc.info ?? '') : '';
    case 'snippet-markdown':
      return isSnippetDoc(doc) ? doc.markdown : '';
  }
}

/**
 * A copy of `doc` with the area set to `text`. Blank notes delete the `notes` key, a blank preamble deletes
 * `preamble` (like the Forge and Inflate editors) and a blank info deletes `info`; a block body and a
 * snippet's markdown are written as is (the server refuses a blank snippet markdown: it is required). `doc` is
 * not mutated, and a document that does not contain the area is returned unchanged (check with `hasTarget`).
 */
export function writeTarget(t: MdTarget, doc: MdDoc, text: string): MdDoc {
  switch (t.kind) {
    case 'context-notes': {
      if (!isContextDoc(doc)) return doc;
      return {
        ...doc,
        links: doc.links.map((l) => {
          if (l.dataset !== t.dataset || l.slug !== t.target) return l;
          const { notes: _removed, ...rest } = l;
          return text.trim() === '' ? rest : { ...rest, notes: text };
        }),
      };
    }
    case 'recipe-preamble': {
      if (!isRecipeDoc(doc)) return doc;
      const { preamble: _removed, ...rest } = doc;
      return text.trim() === '' ? rest : { ...rest, preamble: text };
    }
    case 'recipe-block': {
      if (!isRecipeDoc(doc)) return doc;
      return {
        ...doc,
        markdown: doc.markdown.map((b) => (b.id === t.blockId ? { ...b, body: text } : b)),
      };
    }
    case 'reference-info': {
      if (!isReferenceDoc(doc)) return doc;
      const { info: _removed, ...rest } = doc;
      return text.trim() === '' ? rest : { ...rest, info: text };
    }
    case 'snippet-markdown':
      return isSnippetDoc(doc) ? { ...doc, markdown: text } : doc;
  }
}

/** What the popup holds after a GET. */
export interface LoadedTarget {
  doc: MdDoc;
  lastModified: string;
  /** `readTarget(t, doc)`: the editor's baseline. */
  text: string;
}

export type LoadResult = { ok: true; loaded: LoadedTarget } | { ok: false; message: string };

interface DocResponse {
  context?: ContextDoc;
  recipe?: RecipeData;
  reference?: ReferenceData;
  snippet?: SnippetData;
  lastModified: string;
}

/** GET the yaml document behind `t` and read the area out of it. Never throws. */
export async function loadTarget(t: MdTarget): Promise<LoadResult> {
  const res = await getJson<DocResponse>(endpoint(t));
  if (!res.ok) return { ok: false, message: res.message };
  const doc = res.body[collectionOf(t)];
  if (doc === undefined || typeof res.body.lastModified !== 'string') {
    return { ok: false, message: 'Unexpected response from the server' };
  }
  if (!hasTarget(t, doc)) {
    return { ok: false, message: `${t.label} no longer exists` };
  }
  return {
    ok: true,
    loaded: { doc, lastModified: res.body.lastModified, text: readTarget(t, doc) },
  };
}

export type SaveResult =
  | { ok: true }
  /** The file changed since the popup was opened; `fresh` is what is on disk now. */
  | { ok: false; kind: 'conflict'; fresh: LoadedTarget }
  | { ok: false; kind: 'error'; message: string };

/**
 * Read-modify-write: re-GET, refuse with `conflict` when `lastModified` differs from `base.lastModified`
 * (unless `force`), then PUT the fresh document with `text` written into the area. Never throws. A 400 reports
 * the first validation issue's message.
 */
export async function saveTarget(
  t: MdTarget,
  base: Pick<LoadedTarget, 'lastModified'>,
  text: string,
  opts: { force?: boolean } = {},
): Promise<SaveResult> {
  const current = await loadTarget(t);
  if (!current.ok) return { ok: false, kind: 'error', message: current.message };
  if (opts.force !== true && current.loaded.lastModified !== base.lastModified) {
    return { ok: false, kind: 'conflict', fresh: current.loaded };
  }
  const res = await sendJson<DocResponse>(
    'PUT',
    endpoint(t),
    writeTarget(t, current.loaded.doc, text),
  );
  if (res.ok) return { ok: true };
  return { ok: false, kind: 'error', message: res.issues?.[0]?.message ?? res.message };
}
