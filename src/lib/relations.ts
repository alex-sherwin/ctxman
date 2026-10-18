// PURE (no fs, no astro:*; browser-safe): the relation graph between entries, built from the entry index.
// Edges come from the structured `links` of an okf main.md (frontmatter) and from `ctxman:` links in the
// bodies of an entry's files (mentions). Contexts are not part of the graph. Spec: plans/ROUND3_SPEC.md §C.3.
import type { EntryRel } from '../datasets/registry.ts';
import type { IndexedEntry } from './entry-index.ts';

/** A frontmatter relation kind, or a body mention. */
export type OutRel = EntryRel | 'mentions';

export interface RelationEdge {
  /** Keys 'dataset/slug'. */
  from: string;
  to: string;
  rel: OutRel;
  source: 'frontmatter' | 'body';
  /** Bundle-relative files a mention appears in, first occurrence first; [] for frontmatter edges. */
  files: string[];
}

export interface RelationGraph {
  /** Outgoing edges per entry key (frontmatter edges in file order, then mentions in first-occurrence order). */
  out: ReadonlyMap<string, readonly RelationEdge[]>;
  /** Incoming edges per target key, in the order documented at linkedFrom. */
  in: ReadonlyMap<string, readonly RelationEdge[]>;
}

type GraphSource = Pick<IndexedEntry, 'dataset' | 'slug' | 'relations' | 'mentions'>;

const NO_EDGES: readonly RelationEdge[] = [];

/** Incoming order: Parent (child) -> Required by (depends-on) -> Related -> Mentioned by. */
const IN_RANK: Readonly<Record<OutRel, number>> = {
  child: 0,
  'depends-on': 1,
  related: 2,
  mentions: 3,
};

/**
 * Builds the graph. Per entry: the first frontmatter link to a target wins (one link per target is a schema
 * rule; the duplicate is ignored here), a link to the entry itself is ignored (a check error), and a target
 * with a frontmatter edge gets no extra 'mentions' edge from the same entry. Targets need not exist as entries.
 */
export function buildRelationGraph(entries: readonly GraphSource[]): RelationGraph {
  const out = new Map<string, RelationEdge[]>();
  const incoming = new Map<string, RelationEdge[]>();

  const push = (map: Map<string, RelationEdge[]>, key: string, edge: RelationEdge): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [edge]);
    else list.push(edge);
  };

  for (const entry of entries) {
    const from = `${entry.dataset}/${entry.slug}`;
    const edges: RelationEdge[] = [];
    const targets = new Set<string>([from]);

    for (const link of entry.relations) {
      const to = `${link.dataset}/${link.slug}`;
      if (targets.has(to)) continue;
      targets.add(to);
      edges.push({ from, to, rel: link.rel, source: 'frontmatter', files: [] });
    }

    const mentioned = new Map<string, RelationEdge>();
    for (const mention of entry.mentions) {
      const to = `${mention.dataset}/${mention.slug}`;
      if (targets.has(to)) continue;
      const existing = mentioned.get(to);
      if (existing === undefined) {
        const edge: RelationEdge = {
          from,
          to,
          rel: 'mentions',
          source: 'body',
          files: [mention.file],
        };
        mentioned.set(to, edge);
        edges.push(edge);
      } else if (!existing.files.includes(mention.file)) {
        existing.files.push(mention.file);
      }
    }

    if (edges.length === 0) continue;
    out.set(from, edges);
    for (const edge of edges) push(incoming, edge.to, edge);
  }

  for (const list of incoming.values()) {
    list.sort(
      (a, b) => IN_RANK[a.rel] - IN_RANK[b.rel] || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0),
    );
  }
  return { out, in: incoming };
}

/**
 * Outgoing edges of `key`: frontmatter edges in file order, then one 'mentions' edge per other target
 * (first-occurrence order). [] for an unknown key.
 */
export function linksTo(g: RelationGraph, key: string): readonly RelationEdge[] {
  return g.out.get(key) ?? NO_EDGES;
}

/**
 * Incoming edges of `key`, sorted: child (shown as Parent), depends-on (Required by), related, mentions
 * (Mentioned by); within a group by `from` key. [] for an unknown key.
 */
export function linkedFrom(g: RelationGraph, key: string): readonly RelationEdge[] {
  return g.in.get(key) ?? NO_EDGES;
}

/** Targets of the `child` edges `key` declares, in file order. */
export function childrenOf(g: RelationGraph, key: string): string[] {
  return linksTo(g, key)
    .filter((edge) => edge.rel === 'child')
    .map((edge) => edge.to);
}

/** Entries that declare a `child` edge to `key` (sorted by key). */
export function parentsOf(g: RelationGraph, key: string): string[] {
  return linkedFrom(g, key)
    .filter((edge) => edge.rel === 'child')
    .map((edge) => edge.from);
}
