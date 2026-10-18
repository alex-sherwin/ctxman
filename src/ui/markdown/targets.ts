// Browser-safe (fetch via ui/edit/api.ts only inside functions; no Monaco, no React, nothing touches the DOM at
// import, so the SSR Astro components import the id helpers too): the descriptors and adapters behind the
// markdown popup editors (ROUND2_UI_SPEC §F.2). A "target" is one small markdown area of a context or recipe
// yaml: a link's `notes`, a recipe's `preamble`, or one `markdown` block `body`. The pure adapters
// (`readTarget` / `writeTarget` / `endpoint` / `hasTarget`) never mutate; `loadTarget` / `saveTarget` are the
// read-modify-write round trip against `/api/context/:slug` and `/api/recipe/:slug`.
//
// Those PUTs have no `ifUnmodifiedSince` (unlike `/api/doc`), so `saveTarget` re-GETs right before the PUT and
// compares `lastModified` with the one the editor was opened on (D11). The PUT then carries the FRESH document
// with only this target replaced, so concurrent edits to other parts of the file are never rolled back.
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import type { RecipeData } from '../../datasets/schemas.ts';
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
    };

// ---------------------------------------------------------------- ids shared with the SSR buttons

/** `data-md-edit` of the pencil button for a context link's notes. */
export const noteTargetId = (dataset: string, slug: string): string => `notes:${dataset}:${slug}`;
/** `data-md-edit` of the recipe preamble's pencil button. */
export const PREAMBLE_TARGET_ID = 'preamble';
/** `data-md-edit` of a recipe markdown block's pencil button. */
export const blockTargetId = (blockId: string): string => `block:${blockId}`;

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

/** The yaml document a target lives in: a context (`links`) or a recipe. */
export type MdDoc = ContextDoc | RecipeData;

function isContextDoc(doc: MdDoc): doc is ContextDoc {
  return 'links' in doc;
}

/** `/api/context/<slug>` or `/api/recipe/<slug>`. */
export function endpoint(t: MdTarget): string {
  return `/api/${t.kind === 'context-notes' ? 'context' : 'recipe'}/${encodeURIComponent(t.slug)}`;
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
      return !isContextDoc(doc);
    case 'recipe-block':
      return !isContextDoc(doc) && doc.markdown.some((b) => b.id === t.blockId);
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
      return isContextDoc(doc) ? '' : (doc.preamble ?? '');
    case 'recipe-block':
      return isContextDoc(doc) ? '' : (doc.markdown.find((b) => b.id === t.blockId)?.body ?? '');
  }
}

/**
 * A copy of `doc` with the area set to `text`. Blank notes delete the `notes` key and a blank preamble deletes
 * `preamble` (like the Forge and Inflate editors); a block body is written as is. `doc` is not mutated, and a
 * document that does not contain the area is returned unchanged (check with `hasTarget`).
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
      if (isContextDoc(doc)) return doc;
      const { preamble: _removed, ...rest } = doc;
      return text.trim() === '' ? rest : { ...rest, preamble: text };
    }
    case 'recipe-block': {
      if (isContextDoc(doc)) return doc;
      return {
        ...doc,
        markdown: doc.markdown.map((b) => (b.id === t.blockId ? { ...b, body: text } : b)),
      };
    }
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
  lastModified: string;
}

/** GET the yaml document behind `t` and read the area out of it. Never throws. */
export async function loadTarget(t: MdTarget): Promise<LoadResult> {
  const res = await getJson<DocResponse>(endpoint(t));
  if (!res.ok) return { ok: false, message: res.message };
  const doc = t.kind === 'context-notes' ? res.body.context : res.body.recipe;
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
