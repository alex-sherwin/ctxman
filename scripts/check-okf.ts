// OKF v0.2 conformance of every okf bundle (kb, rca, idea, task, bug, feature, project).
// Usage: node scripts/check-okf.ts [--json]
import { checkOkf } from '../src/lib/okf.ts';
import { runCheckCli } from './cli.ts';

await runCheckCli('check-okf', 'OKF', checkOkf);
