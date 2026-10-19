// Browser-safe data module (no Monaco import): the generated JSON Schemas (static JSON imports, bundled by
// Vite, so `configureMonacoYaml` runs synchronously at module load) and the URI scheme that makes both
// monaco-yaml `fileMatch` and the in-file `# yaml-language-server: $schema=../../schemas/<ds>.schema.json`
// modeline resolve to the registered schema (BACKEND_SPEC §D.5: needs `file:///` URIs, not `inmemory://`).
import type { JSONSchema, SchemasSettings } from 'monaco-yaml';
import contextSchema from '../../../schemas/context.schema.json';
import recipeSchema from '../../../schemas/recipe.schema.json';
import referenceSchema from '../../../schemas/reference.schema.json';
import snippetSchema from '../../../schemas/snippet.schema.json';
import { SCHEMA_DATASETS } from '../../lib/schema-comment.ts';
import type { SchemaDatasetId } from '../../lib/schema-comment.ts';

const SCHEMAS: Record<SchemaDatasetId, JSONSchema> = {
  reference: referenceSchema as unknown as JSONSchema,
  snippet: snippetSchema as unknown as JSONSchema,
  context: contextSchema as unknown as JSONSchema,
  recipe: recipeSchema as unknown as JSONSchema,
};

/** URI the schema is registered under; the modeline `../../schemas/<ds>.schema.json` resolves to it. */
export const yamlSchemaUri = (ds: SchemaDatasetId): string => `file:///schemas/${ds}.schema.json`;

/** Model path for a YAML editor of dataset `ds`; `id` must be unique per mounted editor. */
export const yamlModelPath = (ds: SchemaDatasetId, id: string): string =>
  `file:///data/${ds}/${id}.yaml`;

export const YAML_SCHEMAS: SchemasSettings[] = SCHEMA_DATASETS.map((ds) => ({
  uri: yamlSchemaUri(ds),
  fileMatch: [`**/data/${ds}/*.yaml`],
  schema: SCHEMAS[ds],
}));
