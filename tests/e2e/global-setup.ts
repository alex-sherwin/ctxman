// Before any worker: (1) make sure dist/ is a build of the current sources (E2E_BUILD=auto|always|never, default
// auto: rebuild when any input is newer than dist/server/entry.mjs); (2) create the shared, read-only Inflate
// fixtures (a local git repo reached through git's insteadOf env, and a plain folder). Cross-platform, node:fs only.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASTRO_BIN,
  E2E_GIT_DIR,
  E2E_GIT_FIXTURE,
  E2E_LOCAL_FIXTURE,
  E2E_ROOT,
  SERVER_ENTRY,
} from './paths.ts';

const BUILD_INPUTS = [
  'src',
  'public',
  'astro.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
];

function newestMtime(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs; // a deleted file bumps its parent dir
  for (const name of readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, name)));
  return newest;
}

function ensureBuild(): void {
  const mode = process.env.E2E_BUILD ?? 'auto';
  const built = existsSync(SERVER_ENTRY) ? statSync(SERVER_ENTRY).mtimeMs : 0;
  const stale = built === 0 || Math.max(...BUILD_INPUTS.map(newestMtime)) > built;
  if (mode === 'never' || (mode === 'auto' && !stale)) {
    if (built === 0) throw new Error('dist/server/entry.mjs is missing: run pnpm run build');
    return;
  }
  const result = spawnSync(process.execPath, [ASTRO_BIN, 'build'], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) throw new Error(`astro build failed (${result.status})`);
}

function gitFixture(): void {
  rmSync(E2E_GIT_DIR, { recursive: true, force: true });
  mkdirSync(path.join(E2E_GIT_FIXTURE, 'docs'), { recursive: true });
  writeFileSync(path.join(E2E_GIT_FIXTURE, 'README.md'), '# fixture repo\n');
  writeFileSync(path.join(E2E_GIT_FIXTURE, 'docs', 'guide.md'), '# Guide\n');
  mkdirSync(E2E_LOCAL_FIXTURE, { recursive: true });
  writeFileSync(path.join(E2E_LOCAL_FIXTURE, 'README.md'), '# local folder\n');
  const steps = [
    ['init', '-q', '-b', 'trunk'],
    ['add', '-A'],
    ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'fixture'],
  ];
  for (const args of steps) {
    const r = spawnSync('git', args, { cwd: E2E_GIT_FIXTURE, shell: false, encoding: 'utf8' });
    if (r.status !== 0) {
      // Without git the fixture has no .git: the inflate run specs skip their clone cases.
      rmSync(path.join(E2E_GIT_FIXTURE, '.git'), { recursive: true, force: true });
      console.warn(`[e2e] git ${args.join(' ')} failed (${r.error?.message ?? r.stderr})`);
      return;
    }
  }
}

export default function globalSetup(): void {
  ensureBuild();
  rmSync(E2E_ROOT, { recursive: true, force: true }); // per-worker dirs are recreated by server.ts
  gitFixture();
}
