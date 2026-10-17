// PURE allowlist of scripts the /tools page may run (UI_SPEC §0.5, §I; PLAN §E.17).
// `name` is the URL segment of POST /api/scripts/<name>; `file` is repo-relative and is resolved and
// spawned by src/lib/run-script.ts (never a shell). Nothing outside this list can be executed.

export type ScriptKind = 'check' | 'add';

export const SCRIPTS = [
  {
    name: 'check',
    label: 'All checks',
    description: 'OKF, links and collections in one run.',
    kind: 'check',
    file: 'scripts/check-all.ts',
  },
  {
    name: 'check-okf',
    label: 'OKF conformance',
    description: 'Every okf bundle follows OKF v0.2.',
    kind: 'check',
    file: 'scripts/check-okf.ts',
  },
  {
    name: 'check-links',
    label: 'Markdown links',
    description: 'Intra-bundle and ctxman: links resolve.',
    kind: 'check',
    file: 'scripts/check-links.ts',
  },
  {
    name: 'check-collections',
    label: 'Collections',
    description: 'Every data file matches its schema.',
    kind: 'check',
    file: 'scripts/check-collections.ts',
  },
  {
    name: 'add',
    label: 'Add entry',
    description: 'Scaffold a new entry from the dataset template.',
    kind: 'add',
    file: 'scripts/add-entry.ts',
  },
] as const satisfies readonly {
  name: string;
  label: string;
  description: string;
  kind: ScriptKind;
  file: string;
}[];

export type ScriptName = (typeof SCRIPTS)[number]['name'];

export interface ScriptDef {
  name: ScriptName;
  label: string;
  description: string;
  kind: ScriptKind;
  /** Repo-relative path of the TypeScript file Node runs directly. */
  file: string;
}

const DEFS: readonly ScriptDef[] = SCRIPTS;

export function isScriptName(value: unknown): value is ScriptName {
  return typeof value === 'string' && DEFS.some((s) => s.name === value);
}

export function getScript(name: string): ScriptDef | undefined {
  return DEFS.find((s) => s.name === name);
}
