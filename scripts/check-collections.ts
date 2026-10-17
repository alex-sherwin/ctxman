// Every data file against its dataset schema (what `astro sync` would reject), name == slug, context link targets.
// Usage: node scripts/check-collections.ts [--json]
import { checkCollections } from '../src/lib/collections-check.ts';
import { runCheckCli } from './cli.ts';

await runCheckCli('check-collections', 'Collections', checkCollections);
