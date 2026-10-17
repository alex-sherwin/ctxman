// YAML helpers shared by content.config.ts, scripts, and server libs.
// parseYaml mirrors astro's own parser (@astrojs/internal-helpers/yaml) so a file validates
// identically in `astro sync` and in scripts/check-*.ts: unquoted dates become Date objects.
import { parseDocument, stringify } from 'yaml';

export function parseYaml(source: string): unknown {
  const doc = parseDocument(source, { customTags: ['timestamp'], merge: true, schema: 'core' });
  const first = doc.errors[0];
  if (first) throw first;
  return doc.contents === null ? undefined : doc.toJS();
}

/** Deterministic output for files ctxman writes (context yaml): literal block scalars, no line folding. */
export function stringifyYaml(value: unknown): string {
  return stringify(value, { blockQuote: 'literal', lineWidth: 0 });
}
