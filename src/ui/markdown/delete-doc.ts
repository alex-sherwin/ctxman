// Browser-safe + PURE: the texts of "Delete" on a sub-doc page (DeleteDocButton.tsx): what the confirmation says and
// the status the entry page shows after the DELETE /api/doc call (links that still point at the removed file).

/** The DELETE /api/doc answer. */
export interface DocDeletedBody {
  path: string;
  /** The entry page of the bundle. */
  url: string;
  warnings: { rule: string; file: string; line?: number; message: string }[];
}

/** Below this many linking files the status names them all. */
const NAMED_MAX = 3;

/** What the confirmation says the delete removes. */
export function deleteDocSummary(dataset: string, slug: string, path: string): string {
  return `This removes ${dataset}/${slug}/${path}, the folders it leaves empty and its line in the entry's Concepts list. It can't be undone.`;
}

/**
 * "Deleted concepts/x.md", plus where links to it are left (`log.md:5, concepts/y.md:3`, bundle-relative; at most
 * NAMED_MAX named, then "and N more").
 */
export function deleteDocMessage(
  dataset: string,
  slug: string,
  body: Pick<DocDeletedBody, 'path' | 'warnings'>,
): string {
  const prefix = `${dataset}/${slug}/`;
  const places = body.warnings
    .filter((w) => w.rule === 'links/broken')
    .map((w) => {
      const file = w.file.startsWith(prefix) ? w.file.slice(prefix.length) : w.file;
      return w.line === undefined ? file : `${file}:${w.line}`;
    });
  if (places.length === 0) return `Deleted ${body.path}`;
  const named = places.slice(0, NAMED_MAX).join(', ');
  const more = places.length > NAMED_MAX ? ` and ${places.length - NAMED_MAX} more` : '';
  const links = places.length === 1 ? 'a link to it remains' : 'links to it remain';
  return `Deleted ${body.path}; ${links} in ${named}${more}`;
}
