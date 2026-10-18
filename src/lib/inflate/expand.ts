// PURE (no fs, no astro:*; browser-safe). Expands a recipe into an ordered plan of segments
// (plans/INFLATE_SPEC.md §5, plans/INFLATE_V2_SPEC.md §5: material and primary). The server renders the plan
// (render.ts); the Inflate island runs the same function over cached API data for instant feedback, using
// `ExpandLookup` adapters on both sides.
import type { LinkableDatasetId, ReferenceType } from '../../datasets/registry.ts';
import type { ContextLink, RecipeData, ReferenceData } from '../../datasets/schemas.ts';
import type { EntrySummary } from '../entry-summary.ts';
import type { RemoteUriKind } from '../remote-uri.ts';
import {
  EXTRA_KEY,
  ITEM_KIND_LABELS,
  ctxKey,
  defaultMaterialFor,
  defaultModeFor,
  isMaterialFor,
  isModeFor,
  isPrimaryEligible,
  itemKey,
  itemKindOf,
  mdKey,
  resolveMaterialOptions,
  resolveOptions,
} from './catalog.ts';
import type { InflateOptions, ItemKind, MaterialId, MaterialOptions, ModeId } from './catalog.ts';

// ---------------------------------------------------------------- types

export interface ItemMeta {
  dataset: LinkableDatasetId;
  slug: string;
  /** summary.title ?? summary.name */
  title: string;
  description: string;
  tags: string[];
  state?: string;
  staleAfter?: string;
  stale: boolean;
  refType?: ReferenceType;
  uriKind?: RemoteUriKind;
  /** Reference `subpath` (cleaned, non-empty); the browser knows it from the entry summary, `ref` is server only. */
  subpath?: string;
  /** Full reference data: server only (fs-sources); undefined in the browser. */
  ref?: ReferenceData;
}

export interface ContextLike {
  name: string;
  description: string;
  links: ContextLink[];
}

export type ContextLookup =
  | { status: 'ready'; context: ContextLike }
  | { status: 'missing' }
  | { status: 'invalid'; message: string }
  | { status: 'loading' };
export type ItemLookup =
  | { status: 'ready'; meta: ItemMeta }
  | { status: 'missing' }
  | { status: 'invalid'; message: string }
  | { status: 'loading' };
export interface ExpandLookup {
  context(slug: string): ContextLookup;
  item(dataset: LinkableDatasetId, slug: string): ItemLookup;
}

export type InflateWarningCode =
  | 'context-missing'
  | 'context-invalid'
  | 'item-missing'
  | 'item-invalid'
  | 'mode-invalid'
  | 'override-stale'
  | 'path-missing'
  | 'file-unreadable'
  | 'large-output'
  | 'material-invalid'
  | 'primary-invalid'
  | 'dest-collision'
  | 'source-missing'
  | 'tool-missing'
  | 'manifest-unreadable'
  | 'manifest-other-recipe'
  | 'context-file-edited';
export interface InflateWarning {
  code: InflateWarningCode;
  message: string;
  key?: string;
}
export type SegmentStatus = 'included' | 'excluded' | 'missing' | 'invalid' | 'loading';
export interface Note {
  context: string;
  notes: string;
}

export interface ItemSegment {
  type: 'item';
  key: string;
  dataset: LinkableDatasetId;
  slug: string;
  kind: ItemKind | null;
  meta: ItemMeta | null;
  /** meta?.title ?? slug */
  title: string;
  via: string[];
  adhoc: boolean;
  notes: Note[];
  mode: ModeId | null;
  modeSource: 'default' | 'recipe' | 'override' | null;
  options: Partial<InflateOptions>;
  /** What is placed in a working directory (null until the kind is known). */
  material: MaterialId | null;
  materialSource: 'default' | 'recipe' | 'override' | null;
  /** Only the material's own options, resolved like `options`. */
  materialOptions: Partial<MaterialOptions>;
  status: SegmentStatus;
  group: string | null;
  warnings: InflateWarning[];
}
export interface MarkdownSegment {
  type: 'markdown';
  key: string;
  id: string;
  body: string;
  status: 'included';
  group: string | null;
  warnings: InflateWarning[];
}
export interface ContextIntroSegment {
  type: 'context-intro';
  key: string;
  slug: string;
  title: string;
  description: string;
  crossRefs: string[];
  status: 'included';
  group: null;
  warnings: InflateWarning[];
}
export interface SectionIntroSegment {
  type: 'section-intro';
  key: 'sec:extra';
  title: 'Additional items';
  status: 'included';
  group: null;
  warnings: InflateWarning[];
}
export type Segment = ItemSegment | MarkdownSegment | ContextIntroSegment | SectionIntroSegment;

/** The recipe's `output.primary` after validation against the expanded items. */
export interface PlanPrimary {
  key: string;
  status: 'ok' | 'invalid';
  /** Present when `status` is 'invalid' (the same text as the `primary-invalid` plan warning). */
  message?: string;
}

export interface ExpandedPlan {
  recipe: RecipeData;
  segments: Segment[];
  contexts: { slug: string; status: 'ready' | 'missing' | 'invalid' | 'loading' }[];
  warnings: InflateWarning[];
  staleOverrides: string[];
  /** null when `recipe.output?.primary` is unset. */
  primary: PlanPrimary | null;
  /** Some lookup is still loading (browser only). */
  pending: boolean;
}

// ---------------------------------------------------------------- helpers

export function itemMetaFromSummary(s: EntrySummary): ItemMeta {
  const meta: ItemMeta = {
    dataset: s.dataset as LinkableDatasetId,
    slug: s.slug,
    title: s.title ?? s.name,
    description: s.description,
    tags: s.tags,
    stale: s.stale,
  };
  if (s.state !== undefined) meta.state = s.state;
  if (s.staleAfter !== undefined) meta.staleAfter = s.staleAfter;
  if (s.refType !== undefined) meta.refType = s.refType;
  if (s.uriKind !== undefined) meta.uriKind = s.uriKind;
  if (s.subpath !== undefined) meta.subpath = s.subpath;
  return meta;
}

/**
 * Applies a user order to the default order. 1) `order` filtered to keys of `defaultOrder`, duplicates
 * dropped (first kept). 2) every default key missing from the result is inserted right after the
 * nearest preceding default key that is in the result (index 0 when there is none).
 */
export function applyOrder(defaultOrder: readonly string[], order: readonly string[]): string[] {
  const valid = new Set(defaultOrder);
  const result: string[] = [];
  const present = new Set<string>();
  for (const key of order) {
    if (!valid.has(key) || present.has(key)) continue;
    present.add(key);
    result.push(key);
  }
  defaultOrder.forEach((key, i) => {
    if (present.has(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const index = result.indexOf(defaultOrder[j] ?? '');
      if (index !== -1) {
        at = index + 1;
        break;
      }
    }
    result.splice(at, 0, key);
    present.add(key);
  });
  return result;
}

interface RegistryEntry {
  dataset: LinkableDatasetId;
  slug: string;
  via: string[];
  adhoc: boolean;
  notes: Note[];
}

// ---------------------------------------------------------------- expansion

export function expandRecipe(recipe: RecipeData, lookup: ExpandLookup): ExpandedPlan {
  let pending = false;
  const contextWarnings: InflateWarning[] = [];
  const defaultModeWarnings: InflateWarning[] = [];
  const defaultMaterialWarnings: InflateWarning[] = [];
  const staleWarnings: InflateWarning[] = [];

  // 1. contexts
  const contexts: ExpandedPlan['contexts'] = [];
  const ready: { slug: string; context: ContextLike }[] = [];
  for (const slug of recipe.contexts) {
    const found = lookup.context(slug);
    contexts.push({ slug, status: found.status });
    switch (found.status) {
      case 'ready':
        ready.push({ slug, context: found.context });
        break;
      case 'missing':
        contextWarnings.push({
          code: 'context-missing',
          message: `context "${slug}" does not exist`,
          key: ctxKey(slug),
        });
        break;
      case 'invalid':
        contextWarnings.push({
          code: 'context-invalid',
          message: `context "${slug}" is invalid: ${found.message}`,
          key: ctxKey(slug),
        });
        break;
      case 'loading':
        pending = true;
        break;
    }
  }

  // 2. item registry (insertion order = first seen)
  const registry = new Map<string, RegistryEntry>();
  const register = (dataset: LinkableDatasetId, slug: string): RegistryEntry => {
    const key = itemKey(dataset, slug);
    let entry = registry.get(key);
    if (entry === undefined) {
      entry = { dataset, slug, via: [], adhoc: false, notes: [] };
      registry.set(key, entry);
    }
    return entry;
  };
  for (const { slug, context } of ready) {
    for (const link of context.links) {
      const entry = register(link.dataset, link.slug);
      if (!entry.via.includes(slug)) entry.via.push(slug);
      if (link.notes !== undefined && link.notes.trim() !== '') {
        entry.notes.push({ context: slug, notes: link.notes });
      }
    }
  }
  for (const item of recipe.items) register(item.dataset, item.slug).adhoc = true;

  // 3. default order
  const defaultOrder: string[] = [];
  const queued = new Set<string>();
  const push = (key: string): void => {
    if (queued.has(key)) return;
    queued.add(key);
    defaultOrder.push(key);
  };
  if (recipe.layout === 'grouped') {
    for (const { slug, context } of ready) {
      push(ctxKey(slug));
      for (const link of context.links) {
        const key = itemKey(link.dataset, link.slug);
        if (registry.get(key)?.via[0] === slug) push(key);
      }
    }
    const extras = recipe.items
      .map((item) => itemKey(item.dataset, item.slug))
      .filter((key) => registry.get(key)?.via.length === 0);
    if (extras.length > 0) {
      push(EXTRA_KEY);
      for (const key of extras) push(key);
    }
  } else {
    for (const key of registry.keys()) push(key);
  }
  for (const block of recipe.markdown) push(mdKey(block.id));

  // 4. order
  const keys = applyOrder(defaultOrder, recipe.order);

  // 5. overrides
  const byKey = new Map(recipe.overrides.map((o) => [o.key, o] as const));
  const staleOverrides: string[] = [];
  for (const override of recipe.overrides) {
    if (registry.has(override.key)) continue;
    staleOverrides.push(override.key);
    staleWarnings.push({
      code: 'override-stale',
      message: `override for ${override.key} matches no item in this recipe`,
      key: override.key,
    });
  }

  // 6. items
  const defaultModeWarned = new Set<ItemKind>();
  const defaultMaterialWarned = new Set<ItemKind>();
  const buildItem = (key: string, entry: RegistryEntry): ItemSegment => {
    const { dataset, slug } = entry;
    const segment: ItemSegment = {
      type: 'item',
      key,
      dataset,
      slug,
      kind: null,
      meta: null,
      title: slug,
      via: [...entry.via],
      adhoc: entry.adhoc,
      notes: [...entry.notes],
      mode: null,
      modeSource: null,
      options: {},
      material: null,
      materialSource: null,
      materialOptions: {},
      status: 'invalid',
      group: null,
      warnings: [],
    };
    const found = lookup.item(dataset, slug);
    switch (found.status) {
      case 'missing':
        segment.status = 'missing';
        segment.warnings.push({
          code: 'item-missing',
          message: `${key} does not exist (linked from ${entry.via.join(', ') || 'ad hoc'})`,
          key,
        });
        return segment;
      case 'invalid':
        segment.warnings.push({
          code: 'item-invalid',
          message: `${key} could not be read: ${found.message}`,
          key,
        });
        return segment;
      case 'loading':
        segment.status = 'loading';
        pending = true;
        return segment;
      case 'ready':
        break;
    }

    segment.meta = found.meta;
    segment.title = found.meta.title;
    const kind = itemKindOf(dataset, found.meta.refType);
    if (kind === null) {
      segment.warnings.push({
        code: 'item-invalid',
        message: `${key} could not be read: unknown reference type`,
        key,
      });
      return segment;
    }
    segment.kind = kind;
    const label = ITEM_KIND_LABELS[kind];
    const built = defaultModeFor(kind, recipe.target);
    const kindDefault = recipe.defaults[kind];
    const override = byKey.get(key);

    let mode: ModeId = built;
    let source: NonNullable<ItemSegment['modeSource']> = 'default';
    let fallback: ModeId = built;
    const recipeMode = kindDefault?.mode;
    if (recipeMode !== undefined) {
      if (isModeFor(kind, recipeMode)) {
        mode = recipeMode;
        source = 'recipe';
        fallback = recipeMode;
      } else if (!defaultModeWarned.has(kind)) {
        defaultModeWarned.add(kind);
        defaultModeWarnings.push({
          code: 'mode-invalid',
          message: `default mode "${recipeMode}" does not apply to ${label} items; using "${built}"`,
          key: `defaults.${kind}`,
        });
      }
    }
    const overrideMode = override?.mode;
    if (overrideMode !== undefined) {
      if (isModeFor(kind, overrideMode)) {
        mode = overrideMode;
        source = 'override';
      } else {
        segment.warnings.push({
          code: 'mode-invalid',
          message: `mode "${overrideMode}" does not apply to ${key} (${label}); using "${fallback}"`,
          key,
        });
      }
    }
    segment.mode = mode;
    segment.modeSource = source;
    segment.options = resolveOptions(kind, mode, slug, {
      ...(kindDefault?.options === undefined ? {} : { recipe: kindDefault.options }),
      ...(override?.options === undefined ? {} : { override: override.options }),
    });

    const builtMaterial = defaultMaterialFor(kind, recipe.target);
    let material: MaterialId = builtMaterial;
    let materialSource: NonNullable<ItemSegment['materialSource']> = 'default';
    let materialFallback: MaterialId = builtMaterial;
    const recipeMaterial = kindDefault?.material;
    if (recipeMaterial !== undefined) {
      if (isMaterialFor(kind, recipeMaterial)) {
        material = recipeMaterial;
        materialSource = 'recipe';
        materialFallback = recipeMaterial;
      } else if (!defaultMaterialWarned.has(kind)) {
        defaultMaterialWarned.add(kind);
        defaultMaterialWarnings.push({
          code: 'material-invalid',
          message: `default material "${recipeMaterial}" does not apply to ${label} items; using "${builtMaterial}"`,
          key: `defaults.${kind}`,
        });
      }
    }
    const overrideMaterial = override?.material;
    if (overrideMaterial !== undefined) {
      if (isMaterialFor(kind, overrideMaterial)) {
        material = overrideMaterial;
        materialSource = 'override';
      } else {
        segment.warnings.push({
          code: 'material-invalid',
          message: `material "${overrideMaterial}" does not apply to ${key} (${label}); using "${materialFallback}"`,
          key,
        });
      }
    }
    segment.material = material;
    segment.materialSource = materialSource;
    segment.materialOptions = resolveMaterialOptions(kind, material, {
      ...(kindDefault?.materialOptions === undefined
        ? {}
        : { recipe: kindDefault.materialOptions }),
      ...(override?.materialOptions === undefined ? {} : { override: override.materialOptions }),
    });

    segment.status = override?.exclude === true ? 'excluded' : 'included';
    return segment;
  };

  // 7. segments in key order
  const markdownById = new Map(recipe.markdown.map((b) => [b.id, b] as const));
  const contextBySlug = new Map(ready.map((c) => [c.slug, c.context] as const));
  const segments: Segment[] = [];
  for (const key of keys) {
    if (key === EXTRA_KEY) {
      segments.push({
        type: 'section-intro',
        key: EXTRA_KEY,
        title: 'Additional items',
        status: 'included',
        group: null,
        warnings: [],
      });
    } else if (key.startsWith('ctx:')) {
      const slug = key.slice('ctx:'.length);
      const context = contextBySlug.get(slug);
      if (context === undefined) continue;
      segments.push({
        type: 'context-intro',
        key,
        slug,
        title: context.name,
        description: context.description,
        crossRefs: [],
        status: 'included',
        group: null,
        warnings: [],
      });
    } else if (key.startsWith('md:')) {
      const id = key.slice('md:'.length);
      const block = markdownById.get(id);
      if (block === undefined) continue;
      segments.push({
        type: 'markdown',
        key,
        id,
        body: block.body,
        status: 'included',
        group: null,
        warnings: [],
      });
    } else {
      const entry = registry.get(key);
      if (entry !== undefined) segments.push(buildItem(key, entry));
    }
  }

  // 8. groups
  let current: string | null = null;
  for (const segment of segments) {
    if (segment.type === 'context-intro' || segment.type === 'section-intro') {
      current = segment.key;
    } else {
      segment.group = current;
    }
  }

  // 9. crossRefs
  const byKeySegment = new Map(segments.map((s) => [s.key, s] as const));
  for (const segment of segments) {
    if (segment.type !== 'context-intro') continue;
    const context = contextBySlug.get(segment.slug);
    const refs: string[] = [];
    for (const link of context?.links ?? []) {
      const key = itemKey(link.dataset, link.slug);
      const target = byKeySegment.get(key);
      if (target === undefined || target.status !== 'included') continue;
      if (target.group === segment.key || refs.includes(key)) continue;
      refs.push(key);
    }
    segment.crossRefs = refs;
  }

  // 10. primary repository (working-directory output)
  const primaryWarnings: InflateWarning[] = [];
  let primary: PlanPrimary | null = null;
  const primaryKey = recipe.output?.primary;
  if (primaryKey !== undefined) {
    const seg = segments.find((s): s is ItemSegment => s.type === 'item' && s.key === primaryKey);
    const contextsLoading = contexts.some((c) => c.status === 'loading');
    let message: string | undefined;
    if (seg?.status === 'loading' || (seg === undefined && contextsLoading)) {
      // Provisional while lookups are loading (browser): no verdict yet, no warning.
    } else if (seg === undefined || seg.status !== 'included') {
      message = `primary ${primaryKey} is not an included item of this recipe`;
    } else if (seg.kind !== 'remote-repo' && seg.kind !== 'local-repo') {
      message = `primary ${primaryKey} must be a remote-repo or local-repo reference`;
    } else if (!isPrimaryEligible(seg.kind, seg.material)) {
      message = `primary ${primaryKey} needs material clone (remote-repo) or symlink (local-repo)`;
    }
    if (message === undefined) {
      primary = { key: primaryKey, status: 'ok' };
    } else {
      primary = { key: primaryKey, status: 'invalid', message };
      primaryWarnings.push({ code: 'primary-invalid', message, key: primaryKey });
    }
  }

  // 11. warnings
  const warnings = [
    ...contextWarnings,
    ...defaultModeWarnings,
    ...defaultMaterialWarnings,
    ...segments.flatMap((s) => s.warnings),
    ...primaryWarnings,
    ...staleWarnings,
  ];
  return { recipe, segments, contexts, warnings, staleOverrides, primary, pending };
}
