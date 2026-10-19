// PURE (no fs, no astro:*; browser-safe): per yaml dataset, how the DataForm turns its working document into
// YAML text (the YAML tab), compares two documents (dirty check) and reads an API body (ROUND2_UI_SPEC §H.1).
// The serializers are the same ones the server writers use, so a document round-trips identically.
import type { Type } from 'arktype';
import { DATASET_SCHEMAS } from '../../datasets/schemas.ts';
import type {
  ContextData,
  RecipeData,
  ReferenceData,
  SnippetData,
} from '../../datasets/schemas.ts';
import { validate } from '../../datasets/validate.ts';
import { sameContext, serializeContext } from '../context-yaml.ts';
import { sameRecipe, serializeRecipe } from '../inflate/recipe.ts';
import { sameReference, serializeReference } from '../reference-yaml.ts';
import { sameSnippet, serializeSnippet } from '../snippet-yaml.ts';
import { stringifyYaml } from '../yaml.ts';
import { normalizeDoc } from './fields.ts';
import type { FormDoc, YamlDatasetId } from './fields.ts';

export interface YamlCodec {
  /** The dataset's arktype schema (validates YAML text and API bodies; validate it through datasets/validate.ts). */
  schema: Type<any, any>;
  /**
   * YAML text of a working document. A valid document gets the canonical serializer output; a half-edited
   * (invalid) one still gets a best-effort dump so the YAML tab can show and fix it.
   */
  serialize(doc: FormDoc): string;
  /** True when both documents hold the same data (null equals only null). */
  same(a: FormDoc | null, b: FormDoc | null): boolean;
  /**
   * The document inside an API body (`{ reference|snippet|context|recipe, lastModified }`), deep-copied; null
   * when absent.
   */
  toDoc(apiBody: unknown): FormDoc | null;
}

/** JSON with sorted object keys: equal data compares equal whatever the key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function makeCodec<T>(
  ds: YamlDatasetId,
  serializeValid: (data: T) => string,
  sameValid: (a: T | null, b: T | null) => boolean,
): YamlCodec {
  const schema = DATASET_SCHEMAS[ds];
  return {
    schema,
    serialize(doc) {
      const normalized = normalizeDoc(ds, doc);
      const parsed = validate(schema, normalized);
      return parsed.success ? serializeValid(parsed.data as T) : stringifyYaml(normalized);
    },
    same(a, b) {
      if (a === null || b === null) return a === b;
      const na = normalizeDoc(ds, a);
      const nb = normalizeDoc(ds, b);
      const pa = validate(schema, na);
      const pb = validate(schema, nb);
      if (pa.success && pb.success) return sameValid(pa.data as T, pb.data as T);
      return canonical(na) === canonical(nb);
    },
    toDoc(apiBody) {
      if (typeof apiBody !== 'object' || apiBody === null) return null;
      const doc = (apiBody as Record<string, unknown>)[ds];
      return typeof doc === 'object' && doc !== null && !Array.isArray(doc)
        ? structuredClone(doc as FormDoc)
        : null;
    },
  };
}

export const YAML_CODECS: Record<YamlDatasetId, YamlCodec> = {
  reference: makeCodec<ReferenceData>('reference', serializeReference, sameReference),
  snippet: makeCodec<SnippetData>('snippet', serializeSnippet, sameSnippet),
  context: makeCodec<ContextData>('context', serializeContext, sameContext),
  recipe: makeCodec<RecipeData>('recipe', serializeRecipe, sameRecipe),
};
