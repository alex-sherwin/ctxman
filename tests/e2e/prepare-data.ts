// Copies ./data to .tmp/e2e-data (fresh each run) so e2e tests can write without touching real data.
// Run by playwright.config.ts webServer.command before `astro dev`. Cross-platform (node:fs only).
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  E2E_DATA_DIR,
  E2E_GIT_DIR,
  E2E_GIT_FIXTURE,
  E2E_IDE_COMMAND,
  E2E_IDE_DIR,
  E2E_LOCAL_FIXTURE,
  SOURCE_DATA_DIR,
} from './paths.ts';

const FAKE_CODE_SOURCE = path.resolve('tests', 'e2e', 'fixtures', 'fake-code.mjs');

rmSync(E2E_DATA_DIR, { recursive: true, force: true });
mkdirSync(E2E_DATA_DIR, { recursive: true });
if (existsSync(SOURCE_DATA_DIR)) cpSync(SOURCE_DATA_DIR, E2E_DATA_DIR, { recursive: true });
console.log(`[e2e] data copied to ${E2E_DATA_DIR}`);

// Fake IDE command for api-ide.spec.ts (CTXMAN_IDE_COMMAND points here; the real `code` is never started).
// fixtures/fake-code.mjs appends its argv as one JSON line to CTXMAN_IDE_RECORD.
rmSync(E2E_IDE_DIR, { recursive: true, force: true });
mkdirSync(E2E_IDE_DIR, { recursive: true });
copyFileSync(FAKE_CODE_SOURCE, E2E_IDE_COMMAND);
chmodSync(E2E_IDE_COMMAND, 0o755);
console.log(`[e2e] fake IDE command at ${E2E_IDE_COMMAND}`);

// Inflate fixtures (api-inflate-run.spec.ts): a local git repository reached through the insteadOf env of the web
// server, and a plain folder for local-repo references. The reference YAMLs are written by the spec itself.
rmSync(E2E_GIT_DIR, { recursive: true, force: true });
mkdirSync(E2E_GIT_FIXTURE, { recursive: true });
mkdirSync(path.join(E2E_GIT_FIXTURE, 'docs'), { recursive: true });
writeFileSync(path.join(E2E_GIT_FIXTURE, 'README.md'), '# fixture repo\n');
writeFileSync(path.join(E2E_GIT_FIXTURE, 'docs', 'guide.md'), '# Guide\n');
mkdirSync(E2E_LOCAL_FIXTURE, { recursive: true });
writeFileSync(path.join(E2E_LOCAL_FIXTURE, 'README.md'), '# local folder\n');
const gitSteps = [
  ['init', '-q', '-b', 'main'],
  ['add', '-A'],
  ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'fixture'],
];
let gitReady = true;
for (const args of gitSteps) {
  const result = spawnSync('git', args, { cwd: E2E_GIT_FIXTURE, shell: false, encoding: 'utf8' });
  if (result.status !== 0) {
    gitReady = false;
    console.warn(`[e2e] git ${args.join(' ')} failed (${result.error?.message ?? result.stderr})`);
    break;
  }
}
// Without git the fixture has no .git: api-inflate-run.spec.ts skips its clone cases.
if (!gitReady) rmSync(path.join(E2E_GIT_FIXTURE, '.git'), { recursive: true, force: true });
console.log(`[e2e] git fixture at ${E2E_GIT_FIXTURE}${gitReady ? '' : ' (git unavailable)'}`);
