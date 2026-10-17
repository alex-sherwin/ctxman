// Intra-bundle markdown links and ctxman: links in okf bundles and skill directories.
// Usage: node scripts/check-links.ts [--json]
import { checkLinks } from '../src/lib/links.ts';
import { runCheckCli } from './cli.ts';

await runCheckCli('check-links', 'Links', checkLinks);
