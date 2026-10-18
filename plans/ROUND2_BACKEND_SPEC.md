# Round 2 backend / data / IDE spec (ROUND2_BACKEND_SPEC.md, 2026-10-17)

Scope: brief items 4-backend (doc read/write API), 5-backend, 8-backend (reference CRUD), 9-backend (Tools
navigate), 13 (Open in IDE), 14 (arktype + JSON Schema + yaml-language-server comment + monaco-yaml).
Companion: `plans/ROUND2_UI_SPEC.md` (kit, islands, pages). Read `plans/ROUND2_BRIEF.md` first; its
NON-NEGOTIABLE constraint holds everywhere below: content collections, glob loaders and watchers, `render(entry)`,
`src/lib/entries.ts` and the dev full reload stay UNCHANGED. Nothing in this spec touches `src/content.config.ts`
or `src/lib/entries.ts`.

AGENTS.md rules apply (pnpm only, Node 24 type stripping, erasable syntax, `.ts` extensions in imports, layering
header comment on every `src/lib` file, `src/lib/http.ts` for every JSON response, no shell, tests in temp dirs).

## 0. Decisions (read first)

| # | Decision | Why |
|---|----------|-----|
| D1 | Doc API = new NODE module `src/lib/doc-io.ts` + route `src/pages/api/doc/[dataset]/[slug]/[...path].ts`. Path safety reuses `safeJoin` + a new `resolveBundleFile()` factored out of `readBundleText()` in `bundles.ts` (behaviour of `readBundleText` unchanged). | one containment rule for read and write |
| D2 | PUT always saves (unless the request itself is bad / conflicting) and returns `warnings: Finding[]` computed by the SAME validators the checks use (`validateOkfFile` for okf, a `validateSkillFile` extracted from `collections-check.ts` for `SKILL.md`). Findings of severity `error` are still only warnings to the editor. | the user never loses text; `pnpm run check` stays the gate |
| D3 | Optimistic concurrency: `ifUnmodifiedSince` (ISO, ms precision) must EQUAL the file's current mtime (`stat.mtime.getTime() === Date.parse(ifUnmodifiedSince)`), else 409 `conflict` + current `lastModified`. Omitted = unconditional write. | any change, not only newer, is a conflict |
| D4 | Doc writes are atomic: hidden temp file `.<base>.<pid>.<rand>.tmp` in the target's directory (dot-prefixed so `walkFiles`/freshness/globs ignore it), `chmod` to the old mode, `rename` onto the REAL path (symlinks are resolved first, so a symlinked file inside the bundle stays a symlink target write). | no half-written file is ever seen by the watcher |
| D5 | IDE: `src/lib/ide.ts` (SERVER). argv = `[<entry dir>, <file>]` with NO flags (`code <dir> <dir>/<file>`): verified it opens a window whose workspace root is the folder with the file open, reuses that window when the folder is already open, and opens a separate window even when the repo containing the folder is already open. `-r` is never used (CLI help: replaces the folder of the last active window). | §B experiments |
| D6 | IDE command: `CTXMAN_IDE_COMMAND` (a name looked up in PATH, or a path) else `code` in PATH (PATHEXT on win32), else platform fallbacks. On win32 a `.cmd`/`.bat` is run through `cmd.exe /d /s /c` (Node refuses to spawn .cmd with `shell:false` since the CVE-2024-27980 fix). | cross-platform, still no shell on posix |
| D7 | Reference CRUD mirrors context-io/recipe-io. Serializer goes to a PURE `src/lib/reference-yaml.ts` (islands may use it for a YAML preview); fs side `src/lib/reference-io.ts` (NODE). Reference keeps its glob loader WITH watcher (unchanged): every reference write triggers the dev reload (~0.7 s) and SSR pages / `/api/entries?dataset=reference` see the change only after the content layer re-reads it (measured ~0.65 s); a built server never sees it (snapshot, already an AGENTS.md caveat). | constraint |
| D8 | arktype 2.2.8 is a **devDependency**: `src/datasets/arktypes.ts` + `src/lib/json-schema.ts` are imported only by `scripts/gen-schemas.ts`, `scripts/check-schemas.ts`, `src/lib/schema-check.ts` and tests, never by pages, API routes or islands. zod stays the only runtime validator. | keeps arktype out of SSR and the browser |
| D9 | JSON Schema dialect **draft-07** (`toJsonSchema({ dialect })`), `$id = https://ctxman.local/schemas/<ds>.schema.json` (never fetched), plus yaml-language-server's `patternErrorMessage` (= the field `description`) on every node with a `pattern`. Rules JSON Schema cannot express stay in zod/arktype narrows and are listed in the schema's `$comment`. | best yaml-language-server support; readable IDE errors (verified in monaco-yaml) |
| D10 | `schemas/` is generated and **ignored by oxfmt** (oxfmt reformats `JSON.stringify(…, 2)` output: collapses short arrays). Also added to `.oxlintrc.json` ignorePatterns (AGENTS rule for new top-level dirs). Generator owns the format. | verified both behaviours |
| D11 | The magic comment is NOT part of `serializeContext` / `serializeRecipe` / `serializeReference` (they stay pure data serializers; Forge YAML view and its byte-identity tests are unchanged). It is added by the FILE writers through `withSchemaComment()` (context-io, recipe-io, reference-io, templates). `yaml` parse ignores comments (verified: `parseYaml`, `parseContextYaml`, astro sync, check-all all pass on commented seeds). | minimal churn |
| D12 | Split of the brief's `check:schemas`: (a) `check:schemas` = schema-file drift only (repo-level, exit 1); (b) the first-line comment check is a **collections rule** `collections/yaml-schema-comment` (warning) so it shows in Tools "All checks"; (c) `fix:yaml-comments` inserts/repairs comments (also the one-off seed migration). | data checks stay data-dir based; schema drift is repo based; Tools sees both via `pnpm run check`/All checks |
| D13 | `GET /api/schemas/[dataset]` serves the committed file `schemas/<ds>.schema.json` (cwd-relative like the data dir). In-browser editors do NOT fetch it: they import the JSON statically (Vite), so `configureMonacoYaml` runs synchronously at module load. The API is for external tools / debugging. | no async race before the first YAML model |
| D14 | monaco-yaml 5.5.1 works with monaco-editor 0.57 ONLY with three additions (all verified dev + build + built server): a `createWebWorker` adapter (monaco-worker-manager 2.0.1 calls the pre-0.5x API), a Vite alias for `monaco-editor/esm/vs/editor/editor.worker.js`, and 10 `optimizeDeps.include` entries (else CJS `module is not defined` in the worker and a mid-session dep reload). It honours BOTH `schemas[].fileMatch` and the in-file `# yaml-language-server: $schema=../../schemas/<ds>.schema.json` modeline when model URIs are `file:///data/<ds>/<id>.yaml` and schema URIs `file:///schemas/<ds>.schema.json`. | §D.4 |
| D15 | `EntrySummary.owner?: Owner` (reference only, additive) and `ScriptResult.created.url` (additive). | UI forms / Tools navigation |

Deviations from the brief: D12 (comment check lives in collections, not in `check:schemas`; extra script
`fix:yaml-comments`); D13 (UI imports schemas statically, API kept); D9 draft-07; extra `GET /api/ide/open`
(availability probe, same path); GET doc also returns `bytes` and `warnings`.

## A. Doc API — `GET|PUT /api/doc/<dataset>/<slug>/<...path>`

### A.1 Verified routing facts (Astro 7.4 dev, probe route `[dataset]/[slug]/[...path].ts`, deleted)

| request path (curl `--path-as-is`) | result |
|---|---|
| `kb/ctxman/main.md` | route hit, `params.path = 'main.md'` |
| `kb/ctxman/concepts/datasets.md` | `params.path = 'concepts/datasets.md'` |
| `kb/ctxman/concepts/a%20b.md` | decoded: `'concepts/a b.md'` |
| `kb/ctxman/%2e%2e/%2e%2e/x.md` | normalised by the server before routing → app 404 page (route not hit) |
| `kb/ctxman/a%2Fb.md` | NOT decoded: `'a%2Fb.md'` (then simply not found) |
| `kb/ctxman/..%5Cx.md` | `params.path = '..\\x.md'` → must be rejected (backslash) |
| `kb/ctxman` | route hit with `params.path === undefined` |
| `POST …` | `ALL` export answers |

Clients build the URL as `` `/api/doc/${dataset}/${slug}/${relPath.split('/').map(encodeURIComponent).join('/')}` ``.

### A.2 `src/lib/bundles.ts` (refactor, NODE)

```ts
export type ResolvedBundleFile =
  | { ok: true; root: string; abs: string; realAbs: string; size: number; mtime: Date; mode: number }
  | { ok: false; reason: 'bad-path' | 'no-entry' | 'not-found' | 'outside' };

/**
 * Locates an EXISTING regular file of data/<dataset>/<slug>/ by bundle-relative path: safeJoin, entry dir must
 * exist (`no-entry`), realpath of the file must stay inside the realpath of the entry dir (`outside`, e.g. a
 * symlink out of the bundle), must be a regular file (`not-found` otherwise, also ENOENT/EISDIR).
 */
export async function resolveBundleFile(
  dataset: OkfDatasetId | 'skill', slug: string, relPath: string, dataDir?: string,
): Promise<ResolvedBundleFile>;
```
`readBundleText` is re-implemented on top of it (same null cases, same tests pass unchanged).

### A.3 `src/lib/doc-io.ts` (new, NODE)

```ts
// NODE: read/write ONE existing markdown file of an okf bundle or skill dir (round 2 doc API).
export type DocDatasetId = OkfDatasetId | 'skill';
export function isDocDatasetId(value: unknown): value is DocDatasetId; // OKF_DATASET_IDS + 'skill'

/** Canonical bundle-relative posix path or null: non-empty, no '\\', no NUL, no leading '/', no empty / '.' /
 *  '..' segment, no segment starting with '.', last segment ends with '.md' (case-sensitive), length <= 512. */
export function normalizeDocPath(raw: string | undefined): string | null;

export interface DocRecord {
  dataset: DocDatasetId;
  slug: string;
  /** bundle-relative posix, e.g. 'concepts/search.md' */
  path: string;
  markdown: string;
  /** ISO mtime (ms precision) after the read / write */
  lastModified: string;
  /** UTF-8 byte length of `markdown` */
  bytes: number;
  /** validateDoc() findings; `file` is data-dir relative ('kb/foo/main.md') */
  warnings: Finding[];
}

export class DocIoError extends Error {
  code: 'bad-dataset' | 'bad-slug' | 'bad-path' | 'not-found' | 'too-large' | 'not-text' | 'conflict' | 'invalid';
  issues: Issue[];               // for 'invalid'
  lastModified?: string;         // for 'conflict': the file's CURRENT mtime
}

/** Findings for `source` as if it were saved at <dataset>/<slug>/<relPath>. Never throws.
 *  okf: validateOkfFile({ dataset, bundle: slug, relPath, source, file }) (all severities);
 *  skill + 'SKILL.md': validateSkillFile(source, slug, file) (collections-check.ts); other skill .md: []. */
export function validateDoc(dataset: DocDatasetId, slug: string, relPath: string, source: string): Finding[];

export async function readDoc(dataset: string, slug: string, rawPath: string | undefined, dataDir?: string): Promise<DocRecord>;

/** body = untrusted JSON: { markdown: string, ifUnmodifiedSince?: string } (no other keys). */
export async function writeDoc(dataset: string, slug: string, rawPath: string | undefined, body: unknown, dataDir?: string): Promise<DocRecord>;
```

Order of checks (both): `isDocDatasetId` → `bad-dataset`; `isValidName(slug)` → `bad-slug`;
`normalizeDocPath` → `bad-path`; `resolveBundleFile`: `bad-path`/`outside` → `bad-path`, `no-entry` →
`not-found` ("<dataset> entry \"<slug>\" does not exist"), `not-found` → `not-found` ("<path> does not exist in
<dataset>/<slug>"). Read: size > `MAX_TEXT_BYTES` (512 KB) → `too-large`; buffer contains NUL → `not-text`.

`writeDoc` after resolve: body must be a plain object with `markdown: string` and optional `ifUnmodifiedSince:
string` that `Date.parse`s, no other keys → else `invalid` with issues (`{ path: 'markdown', message: 'must be a
string' }`, `{ path: 'ifUnmodifiedSince', message: 'must be an ISO date string' }`, `{ path: '<key>', message:
'unexpected property' }`); `Buffer.byteLength(markdown) > MAX_TEXT_BYTES` → `too-large`; conflict per D3; then

```ts
const dir = path.dirname(file.realAbs);
const tmp = path.join(dir, `.${path.basename(file.realAbs)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
try {
  await writeFile(tmp, markdown, { encoding: 'utf8', flag: 'wx' });
  await chmod(tmp, file.mode & 0o777);
  await rename(tmp, file.realAbs);
} catch (error) {
  await unlink(tmp).catch(() => undefined);
  throw error; // -> 500 internal
}
```
The markdown is written byte-for-byte as sent (no EOL / trailing-newline normalisation: Monaco keeps the file's EOL).
`warnings = validateDoc(...)` on the new text; `lastModified` from a fresh `stat`.

`collections-check.ts`: extract (no behaviour change) and export
`validateSkillFile(source: string, dirName: string, file: string): Finding[]` (the parseFrontmatter → `collections/schema`
(line from parse error) → skillSchema issues `collections/schema` → `collections/name-mismatch` block of
`checkSkills`); `checkSkills` calls it.

### A.4 Route `src/pages/api/doc/[dataset]/[slug]/[...path].ts`

```text
GET  -> 200 { path, markdown, lastModified, bytes, warnings }
PUT  body { markdown, ifUnmodifiedSince? } -> 200 { path, bytes, lastModified, warnings }
ALL  -> 405 (allow: GET, PUT)
```

| status | error code | when |
|---|---|---|
| 400 | `bad-dataset` | dataset not okf / skill (message lists the allowed ids) |
| 400 | `bad-slug` | slug not a valid name |
| 400 | `bad-path` | `normalizeDocPath` null, escapes the bundle, symlink out |
| 400 | `bad-json` / `invalid` (issues) | PUT body (via `readJson`, then `writeDoc`) |
| 403 | `forbidden-origin` | PUT with foreign `Origin` (readJson) |
| 404 | `not-found` | entry dir or file missing (no create in this round) |
| 405 | `method-not-allowed` | other methods |
| 409 | `conflict` | mtime mismatch; body `{ error, message, lastModified }` (current mtime; use `json(..., 409)`) |
| 413 | `too-large` | file (GET) or body markdown (PUT) > 512 KB |
| 415 | `unsupported-media-type` | PUT not `application/json` |
| 422 | `not-text` | GET of a file containing NUL |
| 500 | `internal` | fs failure (`internalError`) |

Add to `src/lib/http.ts`: `export function docErrorResponse(error: unknown): Response` (DocIoError → table above,
else `internalError`).

### A.5 Dev reload after Save (expected, UI handles it)
A PUT of any okf `.md` (main.md: entry collection; every other file: `docs` collection) or of `SKILL.md` makes
`astro dev` re-read that entry and push a full browser reload ~0.7 s later. A PUT of another `.md` inside a skill dir
(e.g. `references/x.md`) matches no glob and triggers no reload. Both are expected; the editor must not depend on
either (UI spec: after a 200 drop `?edit=1` with `history.replaceState`, show preview; the reload, if any, re-renders
the saved content). A built server never reloads and keeps serving the build-time HTML for collection entries until
rebuilt (existing caveat); GET /api/doc always reads the disk.

## B. Open in IDE — `POST /api/ide/open` (+ `GET` availability probe)

### B.1 Verified on this Mac (VS Code 1.142.0, `/usr/local/bin/code` → `…/Visual Studio Code.app/Contents/Resources/app/bin/code`, a bash script; window titles read with `osascript … get name of every window of process "Code"`; probe windows closed afterwards)

| invocation | result |
|---|---|
| `code <b1> <b1>/main.md` (b1 not open) | NEW window "main.md — b1": workspace root = b1, main.md open. CLI exits 0 in ~1 s |
| `code <b1> <b1>/concepts/c1.md` (b1 open) | NO new window; b1 window focused, c1.md opened in it |
| `code -n <b2> <b2>/main.md`, run twice | first: new window; second: no duplicate (existing b2 window reused) → `-n` adds nothing |
| `code -g <b1>/main.md:3` | opened in the b1 window only because that window exists; with no such window a file-only open lands in the last active window (wrong root) → never file-only |
| `code data/kb/ctxman data/kb/ctxman/main.md` while the ctxman repo window is open | NEW window "main.md — ctxman" rooted at the bundle (not absorbed by the repo window) |
| `code data/reference data/reference/blasto.yaml` | new window rooted at data/reference, file open |
| `-r` | not run: CLI help "Force to open a file or folder in an already opened window" = replaces the last active window's folder. Never use |
| Node `spawn('/usr/local/bin/code', [dir, file], { shell:false, detached:true, stdio:'ignore', windowsHide:true })` | `'spawn'` event, window opened, same as shell |
| spawn `/nonexistent/code` / a non-executable file | `'error'` with `ENOENT` / `EACCES` (no `'spawn'`) |

Result: argv `[rootAbs, fileAbs]`, no flags.

### B.2 `src/lib/ide.ts` (new, SERVER: `node:child_process`, `node:fs`, `node:path`; no astro:*)

```ts
export const IDE_COMMAND_ENV = 'CTXMAN_IDE_COMMAND';

export interface IdeTarget { /** absolute dir = workspace root */ root: string; /** absolute file inside root */ file: string }

export type IdeResolution =
  | { ok: true; command: string }                // absolute path of the executable / .cmd
  | { ok: false; tried: string[] };              // what was searched, for the 501 message

/**
 * CTXMAN_IDE_COMMAND set (non-blank): a value containing '/' or '\\' is a path (resolved against `cwd`), otherwise a
 * name searched in PATH. Explicit config never falls back. Unset: 'code' in PATH, then `platformFallbacks`.
 * PATH: env key matched case-insensitively ('Path' on Windows), split on ';' (win32) or ':'; win32 tries the name
 * as-is if it already ends with a PATHEXT extension, else name + each PATHEXT entry (default '.COM;.EXE;.BAT;.CMD').
 * A candidate counts when statSync(...).isFile() and (posix) accessSync(p, X_OK) succeeds.
 */
export function resolveIdeCommand(opts?: {
  env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; cwd?: string; fallbacks?: readonly string[];
}): IdeResolution;

/** Defaults used when CTXMAN_IDE_COMMAND is unset and PATH has no `code`. */
export function platformFallbacks(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[];
//   darwin: /usr/local/bin/code, /opt/homebrew/bin/code,
//           /Applications/Visual Studio Code.app/Contents/Resources/app/bin/code
//   linux:  /usr/bin/code, /snap/bin/code
//   win32:  %LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd, %ProgramFiles%\Microsoft VS Code\bin\code.cmd

/**
 * okf / skill: root = data/<ds>/<slug> (must be a dir), file = `relPath` (bundle-relative, any existing regular file,
 * resolved with resolveBundleFile) or the entry file (main.md / SKILL.md) when relPath is undefined.
 * reference / context / recipe: root = the data dir, file = <ds>/<slug>.yaml (must exist); relPath must be undefined.
 */
export async function ideTargetFor(
  dataset: DatasetId, slug: string, relPath: string | undefined, dataDir?: string,
): Promise<{ ok: true; target: IdeTarget } | { ok: false; error: 'not-found' | 'bad-path'; message: string }>;

export interface IdeInvocation {
  /** what spawn() runs */ file: string;
  args: string[];
  windowsVerbatimArguments?: true;
  /** reported to the client: [command, root, file] */ display: string[];
}

/**
 * posix, or win32 with a non-.cmd/.bat command: { file: command, args: [root, file] }.
 * win32 + .cmd/.bat: { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${[command, root, file]
 *   .map((a) => `"${a}"`).join(' ')}"`], windowsVerbatimArguments: true }; throws Error('unsupported character')
 * when any of the three contains '"', '%', CR or LF (cmd.exe would reinterpret them).
 */
export function buildIdeInvocation(
  command: string, target: IdeTarget, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv,
): IdeInvocation;

/** spawn(inv.file, inv.args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true, cwd: target.root,
 *  windowsVerbatimArguments }); resolves on 'spawn' (then child.unref()), rejects on 'error'. */
export function launchIde(inv: IdeInvocation, cwd: string): Promise<void>;
```

The child inherits `process.env` unchanged (verified: works from a non-VS Code terminal; from a VS Code integrated
terminal `VSCODE_IPC_HOOK_CLI` routes through that window, which still opens folders in a new window by default).

### B.3 Route `src/pages/api/ide/open.ts`

```text
POST body { dataset: DatasetId, slug: string, path?: string }
  -> 200 { ok: true, command: string[] }        // = invocation.display, absolute paths
GET  -> 200 { available: boolean, command: string | null }   // resolveIdeCommand() only, never spawns
ALL  -> 405 (allow: GET, POST)
```

| status | error | when |
|---|---|---|
| 400 | `bad-json` / `invalid` (issues) | not an object; unknown keys; dataset not a DatasetId; slug not a string; path not a string |
| 400 | `bad-slug` | invalid name |
| 400 | `bad-path` | path given for a yaml dataset, or unsafe / not inside the bundle |
| 403 / 415 | `forbidden-origin` / `unsupported-media-type` | readJson guards |
| 404 | `not-found` | entry dir / yaml file / file at `path` missing |
| 501 | `ide-not-found` | resolution failed; message: `no IDE command found (tried: …); install the VS Code "code" command or set CTXMAN_IDE_COMMAND` |
| 500 | `ide-spawn-failed` | spawn 'error' (EACCES, …) or unsupported character on win32 |

Only paths under the data dir are ever passed (root is an entry dir or the data dir). Security = local-only server
+ Origin guard + fixed command; the request never chooses the executable.

## C. Reference CRUD

### C.1 `src/lib/reference-yaml.ts` (new, PURE; browser-safe)

```ts
/** Serializer key order: name, description, type, path (local-repo) | uri (remote-*), subpath (omitted when
 *  undefined / null / ''), owner, tags (omitted when empty). Matches every seed file and templates.ts. */
export function referenceToYamlObject(r: ReferenceData): Record<string, unknown>;
export function serializeReference(r: ReferenceData): string;          // stringifyYaml(referenceToYamlObject(r))
export function sameReference(a: ReferenceData | null, b: ReferenceData | null): boolean; // JSON of the yaml objects
/** referenceSchema.safeParse + name === expectedName ('name-mismatch'), issues via describeIssue/issuePath. */
export function parseReference(input: unknown, expectedName?: string):
  | { ok: true; reference: ReferenceData }
  | { ok: false; code: 'invalid' | 'name-mismatch'; issues: Issue[] };
/** API body type (zod input). */
export type ReferenceDoc = z.input<typeof referenceSchema>;   // re-export as ReferenceInput from schemas.ts
```
Add `export type ReferenceInput = z.input<typeof referenceSchema>;` to `src/datasets/schemas.ts`.

### C.2 `src/lib/reference-io.ts` (new, NODE) — a mirror of `recipe-io.ts`

```ts
export interface ReferenceRecord { slug: string; reference: ReferenceData; lastModified: string; file: string /* 'reference/<slug>.yaml' */ }
export class ReferenceIoError extends Error {
  code: 'not-found' | 'exists' | 'invalid' | 'bad-slug' | 'name-mismatch' | 'parse'; issues: Issue[];
}
export function referenceFile(slug: string, dataDir?: string): string;            // throws bad-slug
export function validateReference(input: unknown, slug: string): ReturnType<typeof parseReference>;
export async function readReference(slug: string, dataDir?: string): Promise<ReferenceRecord>;   // not-found | parse | invalid
export async function createReference(input: unknown, dataDir?: string): Promise<ReferenceRecord>; // invalid | exists; flag 'wx'
export async function writeReference(slug: string, input: unknown, dataDir?: string): Promise<ReferenceRecord>; // not-found | invalid | name-mismatch; tmp + rename
export async function deleteReference(slug: string, dataDir?: string): Promise<void>;             // not-found
```
File text = `withSchemaComment('reference', serializeReference(reference))` (§D.3). Temp file name as recipe-io
(`${abs}.${process.pid}.tmp`; the reference glob is `*.yaml`, so it is not loaded).

`src/lib/http.ts`: `export function referenceErrorResponse(error: unknown, mode: 'read' | 'write'): Response`
(ReferenceIoError → the shared `ioErrorResponse` table; widen `IoErrorLike` to cover the three classes).

### C.3 Routes (copy `src/pages/api/context/*` exactly, s/context/reference/)

```text
POST   /api/reference            body ReferenceInput -> 201 { reference, lastModified } + Location: /reference/<name>
                                 | 400 invalid (issues) / bad-json | 409 exists | 415 | 403 | 405
GET    /api/reference/:slug      -> 200 { reference, lastModified } | 400 bad-slug | 404 | 422 invalid-file (issues)
PUT    /api/reference/:slug      body ReferenceInput (name == :slug) -> 200 { reference, lastModified }
                                 | 400 invalid / name-mismatch / bad-json / bad-slug | 404 | 415 | 403
DELETE /api/reference/:slug      -> 204 | 400 bad-slug | 404 | 403
ALL    -> 405
```
Changing `type` on PUT is allowed (the discriminated union validates the new shape).

### C.4 What the UI forms get / need (no change to context/recipe routes)
- `GET /api/context/:slug` → `{ context, lastModified }`; `GET /api/recipe/:slug` → `{ recipe, lastModified }`;
  `GET /api/reference/:slug` → `{ reference, lastModified }`. Same PUT/POST/DELETE conventions for all three.
  Popup editors for context link notes / recipe preamble / blocks = GET → modify the one field → PUT the whole doc.
- `EntrySummary.owner?: Owner` (reference only; set when `data.owner` is `me` | `not-me`), additive, so the
  reference list can show / filter owner without fetching each file.
- Freshness after a write (measured, dev): context / recipe lists are current immediately (runtime fs reads);
  reference (and okf / skill) lists and SSR pages lag ~0.6-0.7 s (content layer) and a full reload follows.
  UI rule: treat the API response as the truth; navigate to `/reference/<slug>` only after
  `GET /api/entries?dataset=reference` lists it (same `waitForEntry` helper as §E).

## D. Item 14: arktype models, JSON Schemas, magic comment, monaco-yaml

### D.1 `src/datasets/arktypes.ts` (new, PURE) — EXACT text (verified: tsc 7.1 clean; 92/92 zod-vs-arktype samples agree; run `pnpm run fmt` after pasting, a few lines exceed 100 columns)

```ts
// PURE (no fs, no astro:*; never imported by islands or SSR pages): arktype models of the three YAML
// datasets, mirroring src/datasets/schemas.ts (zod stays the runtime validator for Astro collections and
// every *-io module). Their only job is to generate the JSON Schemas in schemas/ (scripts/gen-schemas.ts);
// tests/unit/arktypes-parity.test.ts keeps them in step with zod.
import { type } from 'arktype';
import {
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  OWNERS,
} from './registry.ts';
import {
  CLONE_DIR_MESSAGE,
  INFLATE_LAYOUTS,
  INFLATE_TARGETS,
  ITEM_KEY_PATTERN,
  ITEM_KINDS,
  MODE_IDS,
  REFERENCE_MODE_IDS,
  SEGMENT_KEY_PATTERN,
  isModeFor,
  modesFor,
  parseItemKey,
} from '../lib/inflate/catalog.ts';
import type { ItemKind } from '../lib/inflate/catalog.ts';
import {
  GIT_URI_MESSAGE,
  SKILL_URI_MESSAGE,
  classifyRemoteUri,
  isGitUri,
} from '../lib/remote-uri.ts';

// ---------------------------------------------------------------- JSON-Schema-only hints

/**
 * Lenient SUPERSET of isGitUri / classifyRemoteUri (scp-style, ssh://, https://), emitted ONLY as the JSON
 * Schema `pattern` of `uri` so editors flag obvious typos. The exact rule stays in the arktype narrow (and zod).
 */
export const REMOTE_URI_HINT_PATTERN =
  '^(?:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\\s:/]\\S*|ssh://\\S+|https://\\S+)$';

/** The language of catalog.isSafeRelativeDir as one regex (parity-tested against it). */
export const CLONE_DIR_PATTERN =
  /^(?!\.\.?(?:\/|$))(?:[A-Za-z0-9._-]|\{name\})+(?:\/(?!\.\.?(?:\/|$))(?:[A-Za-z0-9._-]|\{name\})+)*$/;

export const NAME_MESSAGE =
  'must be kebab-case: a-z, 0-9, single hyphens, no leading/trailing hyphen (max 64 characters)';

// ---------------------------------------------------------------- shared pieces

const name = type(`string <= ${NAME_MAX_LENGTH}`).and(NAME_PATTERN).describe(NAME_MESSAGE);
/** zod `z.string().trim().min(1)`: at least one non-whitespace character. */
const nonBlank = type(/\S/).describe('must not be blank');
const tags = type('string > 0').array().default(() => []);
const owner = type.enumerated(...OWNERS);
const linkableDataset = type.enumerated(...LINKABLE_DATASETS);

/** Narrow predicates: the generator maps them (by identity) to REMOTE_URI_HINT_PATTERN. */
export const gitUriNarrow = (s: string, ctx: { mustBe(expected: string): false }): boolean =>
  isGitUri(s) || ctx.mustBe(GIT_URI_MESSAGE);
export const skillUriNarrow = (s: string, ctx: { mustBe(expected: string): false }): boolean =>
  classifyRemoteUri(s) !== null || ctx.mustBe(SKILL_URI_MESSAGE);

// ---------------------------------------------------------------- reference

export const localRepoReferenceType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  type: "'local-repo'",
  path: 'string > 0',
  'subpath?': 'string',
  owner,
});
export const remoteRepoReferenceType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  type: "'remote-repo'",
  uri: type('string > 0').narrow(gitUriNarrow).describe(GIT_URI_MESSAGE),
  'subpath?': 'string',
  owner,
});
export const remoteSkillReferenceType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  type: "'remote-skill'",
  uri: type('string > 0').narrow(skillUriNarrow).describe(SKILL_URI_MESSAGE),
  'subpath?': 'string | null',
  owner,
});
export const referenceType = localRepoReferenceType
  .or(remoteRepoReferenceType)
  .or(remoteSkillReferenceType);

// ---------------------------------------------------------------- context

export const contextLinkType = type({
  '+': 'reject',
  dataset: linkableDataset,
  slug: name,
  'notes?': 'string',
});
export const contextType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  links: contextLinkType.array().default(() => []),
}).narrow((c, ctx) => {
  // Not expressible in JSON Schema (uniqueItems would compare whole links, notes included).
  const seen = new Set<string>();
  let ok = true;
  c.links.forEach((link, index) => {
    const key = `${link.dataset}/${link.slug}`;
    if (seen.has(key)) ok = ctx.reject({ path: ['links', index], message: `duplicate link ${key}` });
    seen.add(key);
  });
  return ok;
});

// ---------------------------------------------------------------- recipe

export const inflateOptionsType = type({
  '+': 'reject',
  'includeFrontmatter?': 'boolean',
  'includeLog?': 'boolean',
  'shiftHeadings?': 'boolean',
  'rewriteLinks?': 'boolean',
  'eager?': 'boolean',
  'symlink?': 'boolean',
  'treeLimit?': '1 <= number.integer <= 500',
  'cloneDir?': type('1 <= string <= 200').and(CLONE_DIR_PATTERN).describe(CLONE_DIR_MESSAGE),
  'shallow?': 'boolean',
  'sparse?': 'boolean',
});

/** Per-kind default: `mode` is limited to the modes of that kind (zod checks the same in superRefine). */
const kindDefaultType = (kind: ItemKind) =>
  type({
    '+': 'reject',
    'mode?': type.enumerated(...modesFor(kind).map((m) => m.id)),
    'options?': inflateOptionsType,
  });
type KindDefaultType = ReturnType<typeof kindDefaultType>;
const defaultsDef = Object.fromEntries(
  ITEM_KINDS.map((kind) => [`${kind}?`, kindDefaultType(kind)]),
) as Record<`${ItemKind}?`, KindDefaultType>;
export const recipeDefaultsType = type({ '+': 'reject', ...defaultsDef });

export const recipeType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  target: type.enumerated(...INFLATE_TARGETS).default('claude-code'),
  layout: type.enumerated(...INFLATE_LAYOUTS).default('grouped'),
  'preamble?': 'string',
  contexts: name.array().default(() => []),
  items: type({ '+': 'reject', dataset: linkableDataset, slug: name }).array().default(() => []),
  markdown: type({ '+': 'reject', id: name, body: 'string' }).array().default(() => []),
  overrides: type({
    '+': 'reject',
    key: type(ITEM_KEY_PATTERN).describe('must be <dataset>/<slug> of a linkable dataset'),
    'mode?': type.enumerated(...MODE_IDS),
    'options?': inflateOptionsType,
    'exclude?': 'boolean',
  })
    .array()
    .default(() => []),
  order: type(SEGMENT_KEY_PATTERN)
    .describe('must be <dataset>/<slug>, md:<id>, ctx:<context> or sec:extra')
    .array()
    .default(() => []),
  defaults: recipeDefaultsType.default(() => ({})),
}).narrow((r, ctx) => {
  // Duplicates and override-mode applicability: not expressible in JSON Schema.
  let ok = true;
  const duplicates = <T>(
    list: readonly T[],
    keyOf: (item: T) => string,
    path: (index: number) => (string | number)[],
    message: (key: string) => string,
  ): void => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      const key = keyOf(item);
      if (seen.has(key)) ok = ctx.reject({ path: path(index), message: message(key) });
      seen.add(key);
    });
  };
  duplicates(r.contexts, (s) => s, (i) => ['contexts', i], (k) => `duplicate context ${k}`);
  duplicates(r.items, (x) => `${x.dataset}/${x.slug}`, (i) => ['items', i], (k) => `duplicate item ${k}`);
  duplicates(r.markdown, (b) => b.id, (i) => ['markdown', i, 'id'], (k) => `duplicate markdown block id ${k}`);
  duplicates(r.overrides, (o) => o.key, (i) => ['overrides', i, 'key'], (k) => `duplicate override ${k}`);
  duplicates(r.order, (k) => k, (i) => ['order', i], (k) => `duplicate order key ${k}`);
  r.overrides.forEach((override, index) => {
    const parsed = parseItemKey(override.key);
    if (override.mode === undefined || parsed === null) return;
    const applies =
      parsed.dataset === 'reference'
        ? (REFERENCE_MODE_IDS as readonly string[]).includes(override.mode)
        : isModeFor(parsed.dataset, override.mode);
    if (!applies) {
      ok = ctx.reject({
        path: ['overrides', index, 'mode'],
        message: `mode "${override.mode}" does not apply to ${override.key}`,
      });
    }
  });
  return ok;
});

/** The arktype model of each YAML dataset (keys = SCHEMA_DATASETS order). */
export const YAML_DATASET_TYPES = {
  reference: referenceType,
  context: contextType,
  recipe: recipeType,
} as const;
```

Notes (verified):
- `'+': 'reject'` = zod `strictObject` → `additionalProperties: false`. `.default(() => [])` on arrays (a literal
  `[]` default is rejected by arktype). Root objects with defaults + `.narrow` become morphs; their JSON input side is
  produced through the `morph` fallback (`ctx.base`).
- zod `.trim().min(1)` ≡ `/\S/` (JS `\s` == the `String.prototype.trim` whitespace set; tested with `' '`, `'  \n'`, `' x '`).
- arktype sorts properties (required first, then optional, alphabetical within each); output is deterministic.
- Constraints not expressible in JSON Schema (kept in narrows, listed in `$comment`): duplicate links / contexts /
  items / block ids / override keys / order keys; override `mode` vs the key's dataset; exact `isGitUri` /
  archive-vs-git (`uri` gets the lenient `REMOTE_URI_HINT_PATTERN`); `name == file stem` (file-level, never in any
  schema). Per-kind `defaults.<kind>.mode` IS expressed (enum of that kind's modes).

### D.2 `src/lib/json-schema.ts` (new, PURE; scripts + tests only)

```ts
// PURE: JSON Schema documents for the YAML datasets, generated from src/datasets/arktypes.ts.
// Deterministic: same arktype version + same models => byte-identical text. Never import from islands / SSR.
import { REMOTE_URI_HINT_PATTERN, YAML_DATASET_TYPES, gitUriNarrow, skillUriNarrow } from '../datasets/arktypes.ts';
import { SCHEMA_DATASETS } from './schema-comment.ts';
import type { SchemaDatasetId } from './schema-comment.ts';

export const JSON_SCHEMA_DIALECT = 'http://json-schema.org/draft-07/schema#';
export const schemaId = (ds: SchemaDatasetId): string => `https://ctxman.local/schemas/${ds}.schema.json`;

const TITLES: Record<SchemaDatasetId, string> = {
  reference: 'ctxman reference', context: 'ctxman context', recipe: 'ctxman Inflate recipe',
};
const DESCRIPTIONS: Record<SchemaDatasetId, string> = {
  reference: 'data/reference/<name>.yaml: a pointer to a local repo, remote repo or remote skill.',
  context: 'data/context/<name>.yaml: a reusable, evergreen set of links to other ctxman entries.',
  recipe: 'data/recipe/<name>.yaml: a saved Context Inflate composition.',
};
const GENERATED = 'Generated by scripts/gen-schemas.ts from src/datasets/arktypes.ts; do not edit. Not expressible here (checked by pnpm run check): name must equal the file name';
const COMMENTS: Record<SchemaDatasetId, string> = {
  reference: `${GENERATED}; uri must be a real git URI (remote-skill: or an https .tar.gz/.tgz/.zip archive), the pattern is a lenient hint.`,
  context: `${GENERATED}; no duplicate dataset/slug links.`,
  recipe: `${GENERATED}; no duplicate contexts, items, block ids, override keys or order keys; an override mode must apply to the dataset of its key.`,
};

/** arktype does not re-export @ark/schema's ToJsonSchema namespace (and @ark/schema is not a direct dep). */
type ToJsonSchemaOptions = NonNullable<Parameters<(typeof YAML_DATASET_TYPES)['context']['toJsonSchema']>[0]>;

const HINTS = new Map<unknown, string>([
  [gitUriNarrow, REMOTE_URI_HINT_PATTERN],
  [skillUriNarrow, REMOTE_URI_HINT_PATTERN],
]);

const FALLBACK: ToJsonSchemaOptions['fallback'] = {
  // narrow predicates: keep the base schema; the two uri predicates (matched by identity) add the hint pattern
  predicate: (ctx) => {
    const pattern = HINTS.get(ctx.predicate);
    return pattern === undefined ? ctx.base : { ...ctx.base, pattern };
  },
  // root objects with defaults + narrow are morphs: their input side is exactly the file format
  morph: (ctx) => ctx.base,
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** yaml-language-server extension keyword: show `description` instead of the raw regex. */
function addPatternMessages(node: Json): void {
  if (Array.isArray(node)) return node.forEach(addPatternMessages);
  if (node === null || typeof node !== 'object') return;
  if (typeof node.pattern === 'string' && typeof node.description === 'string') {
    node.patternErrorMessage = node.description;
  }
  for (const value of Object.values(node)) addPatternMessages(value);
}

/** Key order: $schema, $id, title, description, $comment, then arktype's keys. */
export function buildJsonSchema(ds: SchemaDatasetId): Record<string, Json> {
  const raw = YAML_DATASET_TYPES[ds].toJsonSchema({ dialect: JSON_SCHEMA_DIALECT, fallback: FALLBACK }) as Record<string, Json>;
  const { $schema, ...rest } = raw;
  addPatternMessages(rest);
  return {
    $schema: $schema ?? JSON_SCHEMA_DIALECT, $id: schemaId(ds), title: TITLES[ds],
    description: DESCRIPTIONS[ds], $comment: COMMENTS[ds], ...rest,
  };
}

/** Exact text of schemas/<ds>.schema.json: JSON.stringify(…, null, 2) + '\n'. */
export function jsonSchemaText(ds: SchemaDatasetId): string {
  return `${JSON.stringify(buildJsonSchema(ds), null, 2)}\n`;
}
export const allSchemaTexts = (): Record<SchemaDatasetId, string> =>
  Object.fromEntries(SCHEMA_DATASETS.map((ds) => [ds, jsonSchemaText(ds)])) as Record<SchemaDatasetId, string>;
```
Verified sizes: reference 5323 B, context 2231 B, recipe 27113 B (inflate options are inlined 12×; acceptable);
two consecutive generations byte-identical. Top-level `reference` is `anyOf` of the three variants (yaml-language-server
picks the branch by `type` const, verified: only the matching branch's errors are shown).

### D.3 `src/lib/schema-comment.ts` (new, PURE; browser-safe) — the magic comment

```ts
export const SCHEMA_DATASETS = ['reference', 'context', 'recipe'] as const;
export type SchemaDatasetId = (typeof SCHEMA_DATASETS)[number];
export function isSchemaDatasetId(value: unknown): value is SchemaDatasetId;
export const schemaFileName = (ds: SchemaDatasetId): string => `${ds}.schema.json`;
/** '# yaml-language-server: $schema=../../schemas/<ds>.schema.json' — relative to data/<ds>/<name>.yaml. Fixed text,
 *  also for a CTXMAN_DATA_DIR outside the repo (the IDE hint then just does not resolve; nothing else depends on it). */
export function schemaCommentLine(ds: SchemaDatasetId): string;
/** `${schemaCommentLine(ds)}\n${body}` (body = a serializer's output, already ending in '\n'). */
export function withSchemaComment(ds: SchemaDatasetId, body: string): string;
/** First line (BOM stripped, CR stripped): 'ok' if === schemaCommentLine(ds); 'wrong' if it starts with
 *  '# yaml-language-server:'; else 'missing'. */
export function schemaCommentStatus(ds: SchemaDatasetId, source: string): 'ok' | 'missing' | 'wrong';
/** Idempotent repair: 'ok' → unchanged; 'wrong' → first line replaced; 'missing' → line prepended (BOM dropped;
 *  CRLF files get '\r\n' after the inserted line). */
export function fixSchemaComment(ds: SchemaDatasetId, source: string): string;
```

Writers that must emit it (file text = `withSchemaComment(ds, serializer(...))`):
`context-io.ts` (createContext, writeContext), `recipe-io.ts` (createRecipe, writeRecipe), `reference-io.ts` (all
writes), `templates.ts` (`case 'data'`: `content: withSchemaComment(dataset, stringifyYaml(dataDoc(...)))`, guard with
`isSchemaDatasetId`). `serializeContext` (context-io and context-yaml), `serializeRecipe`, `serializeReference` do NOT
change. Parsers need no change (verified: `parseYaml`, `parseContextYaml`, `yamlDirLoader`, the reference glob
loader / `astro sync`, `check-all` all accept commented files; `parseYaml('# c\n')` → `undefined`).

Check rule (collections-check.ts, `checkYamlDataset`, after reading the text, before parsing):
`collections/yaml-schema-comment` **warning**, line 1:
- missing: `first line must be "<line>" (pnpm run fix:yaml-comments adds it)`
- wrong: `schema comment must be "<line>" (pnpm run fix:yaml-comments fixes it)`

`scripts/fix-yaml-comments.ts [--json]` (NODE CLI, `CTXMAN_DATA_DIR` aware): for each `<ds>/*.yaml` of
SCHEMA_DATASETS, `fixSchemaComment`; writes only changed files; prints `fixed <ds>/<file>` lines + `N files fixed`;
`--json` → `{ ok: true, fixed: string[] }`; exit 0 (2 on usage). One-off migration = `pnpm run fix:yaml-comments`
on the repo, which changes exactly these 13 seed files:
`data/reference/{anthropic-skills,astro-docs,blasto,catcom,ctxman-repo,flexo,gatos,ksa-modding,purrtty,unscience}.yaml`,
`data/context/{ctxman-dev,okf-authoring}.yaml`, `data/recipe/ctxman-dev-brief.yaml`.

### D.4 Generated files, scripts, API

- `schemas/reference.schema.json`, `schemas/context.schema.json`, `schemas/recipe.schema.json` (committed; repo root).
- `src/lib/data-dir.ts`: `export function resolveSchemasDir(cwd: string = process.cwd()): string` → `path.resolve(cwd, 'schemas')`.
- `scripts/gen-schemas.ts [--json]`: writes `jsonSchemaText(ds)` to `resolveSchemasDir()/<ds>.schema.json` only when
  the text differs (keeps mtimes), creates the dir; prints `wrote …` / `unchanged …`; exit 0.
- `src/lib/schema-check.ts` (NODE): `checkSchemaFiles(schemasDir?: string): Promise<{ findings: Finding[]; filesChecked: number }>`
  rules (Finding.file is REPO-relative here: `schemas/<ds>.schema.json`):
  `schemas/missing` error (file absent), `schemas/drift` error (text differs; message `out of date at line N; run
  pnpm run gen:schemas`), `schemas/stray` warning (any other `*.json` in schemas/).
- `scripts/check-schemas.ts [--json]` = `runCheckCli('check-schemas', 'Schemas', …)` style output (reuse `cli.ts`
  `buildReport`/`formatReport`/`writeJson`, not `runCheckCli` itself, which passes the data dir); exit 1 on errors.
- `package.json` scripts: `"gen:schemas": "node scripts/gen-schemas.ts"`, `"check:schemas": "node scripts/check-schemas.ts"`,
  `"fix:yaml-comments": "node scripts/fix-yaml-comments.ts"`, and
  `"check": "node scripts/check-all.ts && node scripts/check-schemas.ts && astro sync"` (`check:data` unchanged).
- `.oxfmtrc.json` ignorePatterns += `"schemas/**"`; `.oxlintrc.json` ignorePatterns += `"schemas"`. Verified: with the
  ignore entry `oxfmt --check` skips the files (204 vs 208 files checked); without it oxfmt rewrites them (collapses
  `"required": [\n "a",\n "b"\n]` → `["a", "b"]`) and `fmt:check` fails.
- `GET /api/schemas/[dataset]` (`src/pages/api/schemas/[dataset].ts`): `isSchemaDatasetId` else 404 `unknown-dataset`;
  reads `resolveSchemasDir()/<ds>.schema.json` → `new Response(text, { status: 200, headers: { 'content-type':
  'application/schema+json; charset=utf-8', 'cache-control': 'no-store' } })`; ENOENT → 500 `schema-missing`
  (`run pnpm run gen:schemas`); `ALL` → 405 (allow GET).

### D.5 monaco-yaml in the browser (verified: dev on a fresh Vite cache, `astro build`, built server; probe island deleted)

Probe results with the snippet below (markers read via `monaco.editor.getModelMarkers`):

| model URI | text | markers |
|---|---|---|
| `file:///data/context/probe-a.yaml` (fileMatch only, no modeline) | `foo: 1`, `links: [{dataset: context, …}]` | `Property foo is not allowed.`; `Value is not accepted. Valid values: "bug", …` |
| `file:///elsewhere/probe-b.yaml` (no fileMatch) + `# yaml-language-server: $schema=../../schemas/reference.schema.json` | remote-repo, `uri: nope`, `owner: someone` | resolved to the registered `file:///schemas/reference.schema.json`: `must be a git URI: …` (patternErrorMessage), `Value is not accepted. Valid values: "me", "not-me".` |
| `file:///data/recipe/probe-f.yaml` | `defaults.kb.mode: clone`, `cloneDir: ../x`, bad override key / order key | per-kind mode enum, cloneDir message (lookahead regex compiles in the worker), key/order messages |
| valid recipe / reference | — | `[]` |
| `file:///x/probe-e.yaml` (no match, no modeline) | anything | `[]` (syntax errors only) |
| with `inmemory://ctxman/...` URIs | modeline | `Unable to load schema from '/schemas/reference.schema.json': No content.` → use `file:///` URIs |

Failure modes found and fixed (each was reproduced before the fix):
1. `Cannot read properties of undefined (reading 'label')` + `Missing requestHandler or method: doValidation`:
   monaco-worker-manager 2.0.1 (latest, 2022) calls `monaco.editor.createWebWorker({ moduleId, label, createData })`;
   monaco-editor 0.57's public API takes `{ worker, host, keepIdleModels }`. → adapter below.
2. `Failed to resolve import "monaco-editor/esm/vs/editor/editor.worker.js"` (from `monaco-worker-manager/worker.js`):
   0.57's `exports` map (`"./*": "./esm/vs/*.js"`) maps it to a non-existent path. → Vite alias.
3. `Uncaught ReferenceError: module is not defined` in the yaml worker (raw CJS deps such as `path-browserify`) and an
   `optimized dependencies changed. reloading` mid-session. → `optimizeDeps.include` entries below (with them: one
   page load, 0 console errors, 0 non-localhost requests, on a fresh cache).

`astro.config.ts` (`vite` block additions):
```ts
    resolve: {
      alias: [
        {
          // monaco-worker-manager (monaco-yaml's worker) imports a pre-0.5x deep path that monaco-editor 0.57's
          // exports map no longer serves; point it at the public specifier.
          find: /^monaco-editor\/esm\/vs\/editor\/editor\.worker\.js$/,
          replacement: 'monaco-editor/editor/editor.worker',
        },
      ],
    },
    optimizeDeps: {
      include: [
        /* existing 6 */
        'monaco-yaml',
        'monaco-yaml > monaco-worker-manager',
        'monaco-yaml > monaco-worker-manager/worker',
        'monaco-yaml > path-browserify',
        'monaco-yaml > @vscode/l10n',
        'monaco-yaml > vscode-languageserver-types',
        'monaco-yaml > vscode-languageserver-textdocument',
        'monaco-yaml > vscode-uri',
        'monaco-yaml > jsonc-parser',
        'monaco-yaml > prettier',
      ],
    },
```
(Without the alias the pre-bundled `monaco-worker-manager/worker` fails to resolve; verified.)

`src/ui/editor/yaml-schemas.ts` (new, browser data module, no Monaco import):
```ts
// Browser-safe: the generated JSON Schemas (static JSON imports, bundled by Vite) and the URI scheme that makes
// both monaco-yaml `fileMatch` and the in-file `# yaml-language-server: $schema=../../schemas/<ds>.schema.json`
// modeline resolve to the registered schema (verified: needs file:/// URIs, not inmemory://).
import type { JSONSchema, SchemasSettings } from 'monaco-yaml';
import contextSchema from '../../../schemas/context.schema.json';
import recipeSchema from '../../../schemas/recipe.schema.json';
import referenceSchema from '../../../schemas/reference.schema.json';
import { SCHEMA_DATASETS } from '../../lib/schema-comment.ts';
import type { SchemaDatasetId } from '../../lib/schema-comment.ts';

// If tsc rejects a direct `as JSONSchema` on a JSON module type, use `as unknown as JSONSchema`.
const SCHEMAS: Record<SchemaDatasetId, JSONSchema> = {
  reference: referenceSchema as JSONSchema, context: contextSchema as JSONSchema, recipe: recipeSchema as JSONSchema,
};
export const yamlSchemaUri = (ds: SchemaDatasetId): string => `file:///schemas/${ds}.schema.json`;
/** Model path for a YAML editor of dataset `ds`; `id` must be unique per mounted editor. */
export const yamlModelPath = (ds: SchemaDatasetId, id: string): string => `file:///data/${ds}/${id}.yaml`;
export const YAML_SCHEMAS: SchemasSettings[] = SCHEMA_DATASETS.map((ds) => ({
  uri: yamlSchemaUri(ds), fileMatch: [`**/data/${ds}/*.yaml`], schema: SCHEMAS[ds],
}));
```

`src/ui/editor/monaco-setup.ts` additions (module scope, after `loader.config`):
```ts
import { configureMonacoYaml } from 'monaco-yaml';
import YamlWorker from 'monaco-yaml/yaml.worker?worker';
import { YAML_SCHEMAS } from './yaml-schemas.ts';

/**
 * monaco-worker-manager 2.0.1 (monaco-yaml's worker manager) still calls the pre-0.5x
 * `monaco.editor.createWebWorker({ moduleId, label, createData })`; monaco-editor 0.57 takes `{ worker }`.
 * Same steps as 0.57's internal adapter (esm/vs/internal/common/workers.js): post 'ignore', then createData.
 */
interface LegacyWorkerOptions {
  createData?: unknown;
  host?: Record<string, (...args: unknown[]) => unknown>;
  keepIdleModels?: boolean;
}
const monacoForYaml = {
  ...monaco,
  editor: {
    ...monaco.editor,
    createWebWorker: (opts: LegacyWorkerOptions) => {
      const worker = new YamlWorker();
      worker.postMessage('ignore');
      worker.postMessage(opts.createData);
      return monaco.editor.createWebWorker({ worker, host: opts.host, keepIdleModels: opts.keepIdleModels });
    },
  },
} as unknown as typeof monaco;

configureMonacoYaml(monacoForYaml, { enableSchemaRequest: false, format: { enable: false }, schemas: YAML_SCHEMAS });
```
`self.MonacoEnvironment.getWorker` stays as is (the adapter creates the yaml worker itself). The yaml worker
(≈1 MB, includes prettier) is created lazily on the first YAML model; markdown-only pages pay nothing but the
`configureMonacoYaml` registration.

`CodeEditor.tsx` (UI-owned file, 1 prop): `schemaDataset?: SchemaDatasetId`; when set and `language === 'yaml'`
the model path is `yamlModelPath(schemaDataset, safeSegment(testId) + '-' + safeSegment(reactId))`, else the current
`inmemory://ctxman/…` path. Raw file text (with the magic comment) and serializer output (without) both validate.

Dedupe with the existing zod markers (Forge ContextPane): `src/lib/context-yaml.ts` adds
`coveredBySchema: boolean` to `YamlIssue` — `true` for `source: 'yaml'` (syntax) and for zod issues with
`code !== 'custom'`; `false` for `custom` (duplicate links) and the name-immutability issue. An editor that sets
`schemaDataset` passes only `issues.filter((i) => !i.coveredBySchema)` as `markers` (monaco-yaml shows the rest);
`ok` / apply logic is unchanged. Fallback if monaco-yaml must be dropped: remove the setup lines and the alias /
includes; zod markers (all issues) keep working exactly as today.

## E. Tools page: navigate to the created entry (item 9 backend)

- `ScriptResult.created` gains `url: string` (= `entryUrl(dataset, slug)`, e.g. `/task/fix-login`) in
  `run-script.ts` `buildArgs` (still present only when the add exits 0).
- Measured in dev (`CTXMAN_DATA_DIR` scratch copy, `POST /api/scripts/add`, then poll `GET /api/entries?dataset=` every
  50 ms): script run 100-130 ms; entry listed after **627 ms task, 673 ms reference, 602 ms skill, 6 ms context**
  (recipe = runtime read like context); `GET /<ds>/<slug>` 200 once listed. The dev full reload lands ~0.7 s after
  the write, i.e. right around the moment the entry appears.
- UI contract: on `code === 0 && created`: store `{ url, dataset, slug, until: Date.now() + 5000 }` in
  `sessionStorage['ctxman:tools:pending-nav']`, poll `GET /api/entries?dataset=<dataset>` every 150 ms until
  `entries.some(e => e.slug === slug)`, then remove the key and `location.assign(url)`. On page load the Tools store
  resumes a pending-nav that has not expired (the reload may interrupt polling or even the navigation). On timeout
  (built server: okf / skill / reference never appear, snapshot) show "Created <path>; restart the built server to
  see it" and keep the output. Never navigate to a 404.

## F. Docs and data to update (same change as the code; one docs packet, see H)

AGENTS.md:
- Repo map: `schemas/` (generated JSON Schemas, committed, oxfmt/oxlint-ignored); `scripts/`: `gen-schemas`,
  `check-schemas`, `fix-yaml-comments`; `src/datasets/arktypes.ts` (arktype models, generator-only).
- Routes/API list: `GET|PUT /api/doc/<dataset>/<slug>/<...path>`, `GET|POST /api/ide/open`,
  `GET|PUT|DELETE /api/reference/:slug`, `POST /api/reference`, `GET /api/schemas/:dataset`.
- Datasets table: reference / context / recipe files start with `# yaml-language-server: $schema=../../schemas/<ds>.schema.json`.
- Tech: arktype 2.2.8 (devDependency; JSON Schema generation only, never at runtime); monaco-yaml 5.5.1 (client;
  needs the createWebWorker adapter in `monaco-setup.ts`, the Vite alias and the optimizeDeps entries).
- Commands: `gen:schemas`, `check:schemas`, `fix:yaml-comments`; `check` = check-all + check-schemas + astro sync.
- Coding rules / layering: `doc-io.ts`, `reference-io.ts`, `schema-check.ts` NODE; `ide.ts` SERVER;
  `reference-yaml.ts`, `schema-comment.ts`, `json-schema.ts` PURE (json-schema.ts + arktypes.ts: scripts/tests only);
  `src/ui/editor/yaml-schemas.ts` browser data; any YAML data writer must use `withSchemaComment`; arktype models
  must change together with `schemas.ts` (parity test) followed by `pnpm run gen:schemas`.
- Keeping docs current: dataset/field change order gains `arktypes.ts` → `pnpm run gen:schemas` after `schemas.ts`.
- Caveats: in-browser Save of an okf `.md` / `SKILL.md` and every reference write trigger the dev full reload ~0.7 s
  later (expected); `CTXMAN_IDE_COMMAND`; IDE open never passes a file without its folder; the magic comment path is
  only meaningful for the default `./data`.

`data/kb/ctxman` (dated line on top of `log.md`, new concepts in `index.md` if any, then `pnpm run check`):
- `concepts/routes-and-api.md`: the five new endpoints with the status tables of §A.4, §B.3, §C.3, §D.4.
- `concepts/datasets.md`: magic comment, `schemas/`, reference serializer key order, `owner` in EntrySummary.
- `concepts/compliance-checks.md`: `collections/yaml-schema-comment` (warning), `check:schemas` rules
  `schemas/missing`, `schemas/drift` (errors), `schemas/stray` (warning); `pnpm run check` chain.
- `concepts/architecture.md`: arktype (generator-only) vs zod (runtime), monaco-yaml wiring, doc-io / ide / reference-io layering.
- `concepts/adding-entries.md`: YAML entries start with the magic comment; `fix:yaml-comments`; Tools navigates to the new entry.
- `concepts/runtime-modes.md`: save → reload behaviour (§A.5), reference write lag (§C.4), built-server snapshot for API-created references.
- `data/skill/ctxman-add-entry/SKILL.md`: yaml entries carry the comment; never strip it; run `fix:yaml-comments` for hand-made files.
- ctxman's own tracking: set `state` of matching task/feature entries; optional `pnpm run add:rca` for
  "monaco-worker-manager uses the pre-0.5x createWebWorker API" (non-obvious root cause).

## G. Tests

### G.1 vitest (`tests/unit`, temp dirs only; never `./data`; reading committed `schemas/` is allowed)

| file | covers |
|---|---|
| `bundles.test.ts` (extend) | `resolveBundleFile`: ok, `no-entry`, `not-found`, `bad-path` (`../x`, abs, NUL), symlink out → `outside`, symlink inside → ok with `realAbs`; existing `readBundleText` tests unchanged |
| `doc-io.test.ts` (new) | `normalizeDocPath` table (`'a//b.md'`, `'./a.md'`, `'.hidden/x.md'`, `'a\\b.md'`, `'x.MD'`, `'x.txt'`, `''`, `undefined`, 513 chars → null; `'concepts/a b.md'` ok); readDoc ok / 404 entry / 404 file / bad-dataset (`context`) / too-large / not-text; writeDoc: writes exact bytes (CRLF kept), mode kept, no `.tmp` left, `lastModified` changes, `ifUnmodifiedSince` equal → ok, stale → `conflict` with current mtime and file untouched, unparsable date → invalid, unknown key → invalid, too-large; symlinked file inside bundle → link target updated, link kept; warnings: main.md with `state: nope` → `okf/entry-schema` finding but file saved; concept without `type` → `okf/type`; log.md bad heading → `okf/log-heading`; root index.md extra key → `okf/index-frontmatter`; SKILL.md extra key → `collections/schema`, name ≠ dir → `collections/name-mismatch`; skill `references/x.md` → `[]` |
| `collections-check.test.ts` (extend) | `validateSkillFile` parity with `checkSkills`; `collections/yaml-schema-comment` missing / wrong / ok (ok includes BOM + CRLF) |
| `ide.test.ts` (new) | `resolveIdeCommand` with a fake PATH dir (temp dir containing an executable `code`, a non-executable `code` earlier in PATH is skipped, `Path` key casing, win32 PATHEXT `code.cmd` found via `platform:'win32'` + `;` PATH, env override name, env override relative path resolved against `cwd`, missing override → `{ ok:false, tried }` and no fallback, fallbacks used only when unset); `buildIdeInvocation` posix argv `[root, file]`, win32 `.exe` direct, win32 `.cmd` → ComSpec + `/d /s /c` quoted line + `windowsVerbatimArguments`, rejects `%`/`"`; `ideTargetFor` okf default main.md, skill SKILL.md, explicit concept path, yaml dataset → data dir + file, yaml + path → bad-path, missing → not-found; `launchIde` (skip on win32) with a temp `#!/usr/bin/env node` recorder (chmod 755) that writes `process.argv.slice(2)` to `$CTXMAN_IDE_RECORD`: resolves, recorded argv == `[root, file]` (poll ≤ 2 s); non-executable → rejects EACCES |
| `reference-yaml.test.ts` (new) | key order for the 3 types, subpath omitted for undefined/null/'', tags omitted when empty, round-trip parse → serialize → parse equal, every seed-like fixture serializes byte-identically to its hand-written text, `parseReference` name-mismatch |
| `reference-io.test.ts` (new, mirror `recipe-io.test.ts`) | create (file = `withSchemaComment('reference', serializeReference(...))`, `exists`), read (not-found, parse, invalid, name ≠ stem), write (not-found, name-mismatch, type change ok, atomic: no tmp left), delete |
| `http.test.ts` (extend) | `referenceErrorResponse` and `docErrorResponse` status/code table |
| `schema-comment.test.ts` (new) | `schemaCommentLine` exact text per dataset; `withSchemaComment`; status ok/missing/wrong incl. BOM/CRLF; `fixSchemaComment` idempotent (fix(fix(x)) === fix(x)), preserves the rest byte-for-byte |
| `arktypes-parity.test.ts` (new) | for every sample: `zodSchema.safeParse(v).success === !(arkType(v) instanceof type.errors)`. Samples (all inline): reference — valid remote-repo / local-repo / remote-skill (git and archive, `subpath: null`), extra key, `name` 'A' / 65 chars / 64 chars, description `'  \n'` / `' x '` / `' '`, bad type, missing / bad owner, archive uri on remote-repo, `subpath: null` on remote-repo, `uri` on local-repo, empty path, tags `['']` / `['a']`, `https://host`, `ssh://git@h/o/r.git`, `http://h/o/r`, `null`, `[]`; context — ok, no links, duplicate link, link to `context` / `recipe`, extra link key, numeric notes, `links: null`, extra key; recipe — minimal, target ok/bad, layout, duplicate contexts / items / block ids / override keys / order keys, bad block id, override mode ok / not applicable (`kb/x` + `install`), `reference/x` + `clone` ok / + `inline` bad, override key `context/x`, order `sec:extra` / `sec:other`, defaults ok / unknown kind `context` / mode not of kind (`kb` + `clone`), treeLimit 0 / 1.5 / 500, unknown option, preamble string / number, cloneDir table (`.ctxman/{name}`, `{name}`, `../x`, `a/./b`, `a//b`, `/abs`, `{nam}`, `a b`, `...`, `a/..`, `.x`, `x.`, 201 chars, `{name}{name}`, `.{name}`, `ok/dir-1_2`, `''`); plus `CLONE_DIR_PATTERN.test(s) === isSafeRelativeDir(s)` for every cloneDir sample of length 1..200; plus every `planNewEntry` yaml output (reference 3 types, context, recipe) parses and validates in both. (Scratch run of this exact set: 92 checked, 0 mismatches.) |
| `json-schema.test.ts` (new) | `jsonSchemaText(ds)` twice → identical; equals `readFileSync('schemas/<ds>.schema.json')` (committed files current); top-level keys start `$schema,$id,title,description,$comment`; dialect draft-07; every node with `pattern` + `description` has `patternErrorMessage`; reference `uri` patterns == `REMOTE_URI_HINT_PATTERN`; `recipe.properties.defaults.properties` keys == sorted ITEM_KINDS, each `mode.enum` == that kind's mode ids; every `additionalProperties` is `false` |
| `schema-check.test.ts` (new) | temp schemas dir: all current → 0 findings; one missing → `schemas/missing`; one edited → `schemas/drift` with line; extra json → `schemas/stray` |
| `templates.test.ts` (update) | reference ×3, context, recipe expectations gain the first line `# yaml-language-server: $schema=../../schemas/<ds>.schema.json\n` |
| `recipe-io.test.ts:114` (update) | `expect(text).toBe(withSchemaComment('recipe', serializeRecipe(created.recipe)))` |
| `context-io.test.ts` (extend) | created / written file starts with the comment (existing `toContain` assertions unchanged) |
| `context-yaml.test.ts` (extend) | `coveredBySchema` true for syntax / shape issues, false for duplicate link and name change (byte-identity test at line 56 unchanged: serializers untouched) |
| `entry-summary.test.ts` (extend) | reference `owner` me / not-me / absent / invalid value → omitted |
| `run-script.test.ts` / `scripts.test.ts` (update) | `created.url`; the `warnOnly` fixture `context/dangling.yaml` and any other inline yaml in check-all CLI tests get the comment line (else `All checks: 0 errors, 2 warnings`); `fix-yaml-comments.ts` CLI on a temp dir (fixes 3 files, second run fixes 0, `--json`); `gen-schemas.ts` not run against the repo in tests (it writes) — test `check-schemas.ts` CLI exit 0 on the repo |
| `fixtures/data-fixtures.ts` (update) | `validDataTree()` yaml files start with the comment line (keeps `collections-check.test.ts:11` at 0 findings); fixtures in `collections-check.test.ts` filtered by file prefix (lines ~111, ~169) get the comment or filter by rule |

### G.2 Playwright (`tests/e2e`, port 4322, e2e data copy; names `e2e-*`)

Shared infra (owned by B5): `tests/e2e/paths.ts` adds `E2E_IDE_DIR = path.resolve('.tmp','e2e-ide')`,
`E2E_IDE_COMMAND = path.join(E2E_IDE_DIR, 'fake-code')`, `E2E_IDE_RECORD = path.join(E2E_IDE_DIR, 'calls.jsonl')`;
`prepare-data.ts` (re)creates the dir and writes `fake-code` (`#!/usr/bin/env node` + append
`JSON.stringify(process.argv.slice(2))+'\n'` to `process.env.CTXMAN_IDE_RECORD`), chmod 0o755; `playwright.config.ts`
webServer env += `CTXMAN_IDE_COMMAND: E2E_IDE_COMMAND, CTXMAN_IDE_RECORD: E2E_IDE_RECORD`.

| spec | tests |
|---|---|
| `api-doc.spec.ts` (B4) | create `e2e-doc-<rand>` via `POST /api/scripts/add` (fs is read directly, no wait needed); GET main.md → 200 shape, `warnings: []`; PUT new text → 200, file bytes equal, `lastModified` advanced; PUT with the old `lastModified` → 409 `conflict` + current `lastModified`; PUT frontmatter `state: nope` → 200 + `okf/entry-schema` warning and the file contains the text; GET `concepts/../../x.md`-style (`..%5Cx.md`) → 400 `bad-path`; `x.txt` → 400; missing file → 404; `context/ctxman-dev/x.md` → 400 `bad-dataset`; skill `ctxman-add-entry/SKILL.md` GET 200; PUT text/plain → 415; foreign Origin → 403; POST → 405. Restore any seed it touched (it touches none). |
| `api-ide.spec.ts` (B5; `test.skip(process.platform === 'win32')`) | GET → `{ available: true, command: E2E_IDE_COMMAND }`; POST kb/ctxman → 200, `command` == `[E2E_IDE_COMMAND, <data>/kb/ctxman, <data>/kb/ctxman/main.md]`, recorder line (poll ≤ 3 s) == `[root, file]`; POST with `path: 'concepts/datasets.md'`; POST reference `ctxman-repo` → root = e2e data dir; yaml + path → 400 `bad-path`; unknown slug → 404; bad dataset → 400; then rename `fake-code` away → POST → 501 `ide-not-found` and GET `available: false`; rename back (in `finally`). |
| `api-reference.spec.ts` (B3) | POST `e2e-ref-<rand>` → 201 + Location, file starts with the comment, key order; GET → 200; PUT description → 200; PUT name change → 400 `name-mismatch`; PUT invalid uri → 400 `invalid` issues path `uri`; POST again → 409 `exists`; GET bad slug → 400; DELETE → 204 then GET 404; 415 / 403 / 405; after POST, `GET /api/entries?dataset=reference` lists it within 5 s (poll). |
| `api-schemas.spec.ts` (B1) | GET reference / context / recipe → 200, `content-type` starts with `application/schema+json`, `cache-control: no-store`, `$id` / `$schema` as §D.2; GET `kb` → 404 `unknown-dataset`; POST → 405. |

## H. Backend work packets

Waves: **W0** = B0 (tiny, shared constant module); **W1** = B1, B2, B4, B5, B6 (parallel-safe, disjoint owned
files; the shared-file column says who edits which function); **W2** = B3, B7 (need B0 + B1's `schemas/*.json`);
**W3** = B8 docs (after all code, merged with the UI docs packet into ONE owner). Every packet ends with `pnpm run typecheck && pnpm run lint && pnpm run fmt:check &&
pnpm run test` plus its listed commands; W3 ends with `pnpm run test:all`.

| packet | owns (exclusive) | touches shared (coordinate) | acceptance |
|---|---|---|---|
| **B0 schema-comment** (W0) | `src/lib/schema-comment.ts` (all of §D.3's exports), `tests/unit/schema-comment.test.ts` | — | unit |
| **B1 schemas** | `src/datasets/arktypes.ts`, `src/lib/json-schema.ts`, `src/lib/schema-check.ts`, `scripts/gen-schemas.ts`, `scripts/check-schemas.ts`, `schemas/*.schema.json` (generated), `src/pages/api/schemas/[dataset].ts`, tests `arktypes-parity`, `json-schema`, `schema-check`, e2e `api-schemas.spec.ts` | `package.json` scripts (`gen:schemas`, `check:schemas`, `check` chain), `.oxfmtrc.json`, `.oxlintrc.json`, `src/lib/data-dir.ts` (`resolveSchemasDir`); imports `SCHEMA_DATASETS` from B0 | `pnpm run gen:schemas` then `pnpm run check:schemas` exit 0; `git diff --exit-code schemas/` after a second `gen:schemas`; `pnpm exec oxfmt --check` clean; `pnpm exec playwright test tests/e2e/api-schemas.spec.ts` |
| **B2 magic comment** | `scripts/fix-yaml-comments.ts`, the 13 seed yaml files (via the script) | `context-io.ts`, `recipe-io.ts`, `templates.ts` (+ `templates.test.ts`, `recipe-io.test.ts`, `context-io.test.ts`), `collections-check.ts` (rule + its tests), `fixtures/data-fixtures.ts`, `scripts.test.ts`, `package.json` (`fix:yaml-comments`) | `pnpm run fix:yaml-comments` then a second run reports 0 fixed; `pnpm run check` 0 errors / 0 warnings; `pnpm run add:context e2e-tmp-x` file starts with the comment (delete it after) |
| **B4 doc API** | `src/lib/doc-io.ts`, `src/pages/api/doc/[dataset]/[slug]/[...path].ts`, tests `doc-io`, e2e `api-doc.spec.ts` | `bundles.ts` (`resolveBundleFile`), `collections-check.ts` (`validateSkillFile` extraction — same file as B2: B4 edits only `checkSkills`, B2 only `checkYamlDataset`; merge order B2 → B4 or one agent), `http.ts` (`docErrorResponse`) | unit + `pnpm exec playwright test tests/e2e/api-doc.spec.ts` |
| **B5 IDE** | `src/lib/ide.ts`, `src/pages/api/ide/open.ts`, tests `ide`, e2e `api-ide.spec.ts` | `tests/e2e/paths.ts`, `tests/e2e/prepare-data.ts`, `playwright.config.ts` (env); uses `resolveBundleFile` from B4 (B5 may call `safeJoin` + realpath itself if B4 is not merged yet; switch afterwards) | unit + `pnpm exec playwright test tests/e2e/api-ide.spec.ts`; manual: `curl -s -X POST -H 'content-type: application/json' -d '{"dataset":"kb","slug":"ctxman"}' http://127.0.0.1:4321/api/ide/open` opens a VS Code window "main.md — ctxman" |
| **B6 summary + tools** | — | `src/lib/entry-summary.ts` (`owner`), `src/lib/run-script.ts` (`created.url`), their tests | unit |
| **B3 reference CRUD** (W2) | `src/lib/reference-yaml.ts`, `src/lib/reference-io.ts`, `src/pages/api/reference/index.ts`, `src/pages/api/reference/[slug].ts`, tests `reference-yaml`, `reference-io`, e2e `api-reference.spec.ts` | `src/datasets/schemas.ts` (`ReferenceInput` type only), `http.ts` (`referenceErrorResponse`, after B4's edit) | unit + `pnpm exec playwright test tests/e2e/api-reference.spec.ts` |
| **B7 monaco-yaml** (W2) | `src/ui/editor/yaml-schemas.ts` | `astro.config.ts` (alias + optimizeDeps), `src/ui/editor/monaco-setup.ts`, `src/ui/editor/CodeEditor.tsx` (`schemaDataset` prop; UI-owned), `src/lib/context-yaml.ts` (`coveredBySchema`) + test, Forge `ContextPane.tsx` (pass `schemaDataset="context"` and filter markers; UI-owned) | `pnpm run build`; dev: Forge YAML view with `foo: 1` shows the monaco-yaml marker "Property foo is not allowed." and no duplicate; 0 console errors; no `optimized dependencies changed. reloading` in the dev log on a fresh `rm -rf node_modules/.vite` start (UI e2e owns the browser test) |
| **B8 docs** (W3) | — | `AGENTS.md`, `data/kb/ctxman/**`, `data/skill/ctxman-add-entry/SKILL.md` (§F) | `pnpm run check` 0/0; `pnpm run test:all` |

Shared files the UI packets ALSO touch (sequence them): `package.json` (scripts here; UI may add deps),
`astro.config.ts` (B7; UI may add optimizeDeps for new client deps — merge the include lists),
`src/lib/entry-summary.ts` (B6 adds `owner`; UI reads it), `src/lib/run-script.ts` `created.url` (B6; Tools UI
consumes), `src/lib/templates.ts` (B2), `src/ui/editor/CodeEditor.tsx` + `monaco-setup.ts` + Forge `ContextPane.tsx`
(B7 vs UI editor/Forge packets), `src/lib/context-yaml.ts` (B7), `src/lib/http.ts` (B3, B4), `playwright.config.ts`
/ `tests/e2e/paths.ts` / `prepare-data.ts` (B5), `AGENTS.md` and `data/kb/ctxman/**` (one docs owner).

## I. Commands run while planning (results)

- `pnpm add -D arktype@2.2.8` (latest; devDependency) and `pnpm add monaco-yaml@5.5.1` (latest; peer
  `monaco-editor >=0.36`, but see D14): both installed, exact versions written to `package.json` like the rest.
  These two `package.json` lines + `pnpm-lock.yaml` are the only repo changes besides this spec.
- arktype probes (scratchpad, importing repo modules): JSON Schema output inspected; predicate / morph fallbacks;
  `predicate` identity preserved (`ctx.predicate === fn`); parity 92/92; `tsc -p` (repo tsconfig, TS 7.1) clean;
  generation deterministic.
- YAML comment: `parseYaml`, `parseContextYaml` ignore it; scratch copy of `data/` with comments on all 13 files:
  `check-all` unchanged result, `CTXMAN_DATA_DIR=<copy> astro sync` OK.
- monaco-yaml: throwaway `client:only` island + page + `--config` override file (all deleted): failure modes 1-3 of
  §D.5 reproduced and fixed; diagnostics table; fresh-cache dev = 1 page load; `astro build --outDir <scratch>`
  OK (emits `yaml.worker-*.js`, ~1.0 MB); built server same markers, 0 errors, 0 external requests.
- Astro rest-param probe route (§A.1), deleted.
- VS Code CLI table (§B.1); probe windows closed.
- Tools timing (§E) against a scratch data copy on a throwaway dev server (port 4331), killed.
- `oxfmt --check` on generated JSON: fails without ignore, skipped with ignore (§D.4).
- Noticed (not caused by this work): during planning `data/kb/aaa/` (no index.md / main.md) briefly existed and made
  `check-all` report 1 error + 1 warning; it was gone at the end. `astro build` printed glob-loader "multiple entries
  with the same slug" warnings once because an earlier `astro sync` against the scratch data dir had populated the
  shared data store; a plain `pnpm exec astro sync` afterwards restored it.
