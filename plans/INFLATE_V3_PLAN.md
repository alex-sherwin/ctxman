# Inflate v3: placement first

Status: plan (2026-10-18). Builds on `INFLATE_SPEC.md` (v1, the document) and `INFLATE_V2_SPEC.md` (v2, the
working directory). The user-facing doc to update at the end is `tests/data/kb/ctxman/concepts/context-inflate.md`.

## 1. Analysis: how Inflate is used, and where it gets in the way

Day to day, a person has contexts already curated (knowledge, tasks, bugs, repositories, skills). Inflating means:
pick a recipe, make sure every item lands in the working directory the right way, mark the repository to work in,
run, then start Claude Code / Codex in that directory. `CLAUDE.md` is `@LLM_CONTEXT.md`, so the WHOLE context file
is loaded into the agent's context at session start: every inlined byte costs tokens in every session.

Problems found in the current implementation:

1. **Two overlapping per-item axes.** Each item has a *mode* (how the document presents it) and a *material* (what a
   run places). With a directory set, both selects show on every row, and many combinations are redundant or
   contradictory:
   - an okf bundle that is **symlinked** still defaults to mode `inline-main`, so its body is duplicated into
     `LLM_CONTEXT.md` even though the files are right there (`kb/<slug>/`). This is the main complaint;
   - remote-repo mode `clone` (shell commands with `cloneDir`/`shallow`/`sparse`) next to material `clone` (a real
     clone with `cloneDepth`/`branch`/`subpathOnly`): two sets of clone options; the renderer silently ignores the
     mode once the material places the item;
   - skill mode `install` with option `symlink` (commands) next to material `copy`.
2. **Defaults do not match intent.** local-repo and remote-repo default to `none`; skills only `copy` (no symlink).
   Wanted: remote repo → clone, remote skill → clone (git) / download (https archive), local skill → symlink, local
   repository or folder → symlink (copy possible), okf bundle → symlink.
3. **Vague labels.** Remote skills say "Install" whether that means a git clone or an archive download; "Mention
   only" is not obviously "nothing is placed".
4. **The generated file does not explain itself.** Paths are backticked (not links); nothing says what a symlink, a
   copy or a clone implies for edits and re-runs; ownership only appears on reference meta lines; repositories other
   than the primary have no notion of "you may edit this"; repositories and skills are described twice (in the
   Repositories / Skills sections AND as items in their context).
5. **Choices are scattered.** Defaults per item kind list all 11 kinds even when the recipe has three of them.

## 2. The model after v3

In a **working directory** every item answers two questions, in this order:

1. **Place**: how it gets into the directory (the existing *material*): Symlink, Copy, Clone, Download, Don't place.
2. **In LLM_CONTEXT.md**: how the context file presents it (the existing *mode*), with a choice list and default that
   depend on whether the item is placed. A placed item is **referenced with relative markdown links**, not inlined,
   unless the user asks for inlining.

Repositories additionally have **Primary** (single choice, unchanged) and a new **Editable** flag (may the session
change files there). In **document-only** output (no directory) nothing changes for the user: only the mode select
("Include as") is shown and the defaults stay as today.

Mode ids, material ids and the recipe file format stay backward compatible: every v2 recipe parses and keeps its
explicit choices. Only built-in DEFAULTS change, plus one new optional override key (`edit`).

## 3. Catalog (`src/lib/inflate/catalog.ts`, PURE)

### 3.1 Materials

| Kind | Materials, in Select order (first = default) | Labels |
| --- | --- | --- |
| okf (kb, rca, idea, task, bug, feature, project) | `symlink`, `copy`, `none` | Symlink · Copy · Don't place |
| `skill` | `symlink` (NEW), `copy`, `none` | Symlink · Copy · Don't place |
| `local-repo` | `symlink`, `copy` (NEW), `none` | Symlink · Copy · Don't place |
| `remote-repo` | `clone`, `none` | Clone · Don't place |
| `remote-skill` | `install`, `none` | Clone (git URI) / Download (archive URI) · Don't place |

- `defaultMaterialFor(kind, target)` returns the first entry: okf symlink, skill **symlink**, local-repo **symlink**,
  remote-repo **clone**, remote-skill install.
- `none` is relabelled **"Don't place"** everywhere (description: "Nothing is placed; LLM_CONTEXT.md points at the
  original path or URI.").
- Descriptions (Select item descriptions) say the implication, e.g. symlink "Link to the original; edits change it.",
  copy "Snapshot; replaced on every run.", local-repo copy "Snapshot without .git and node_modules at repos/<name>;
  replaced on every run.", clone "git clone into repos/<name>; later runs pull (fast-forward only).".
- NEW `materialLabel(kind, material, uriKind?: RemoteUriKind): string` and `materialDescription(...)`: remote-skill
  `install` is "Clone" for a git URI, "Download" for an archive URI, "Clone or download" when unknown; everything else
  is the static label. The UI and the renderer use these helpers, never `MaterialDef.label` directly for remote skills.
- `REFERENCE_MATERIAL_IDS` gains `copy` (a `reference/<slug>` override may now name copy).
- Primary eligibility is unchanged: remote-repo `clone`, local-repo `symlink` (a copy has no `.git`).

### 3.2 Editable (new)

- `isEditEligible(kind, material): boolean` = (`local-repo` and material `symlink` or `none`) or (`remote-repo` and
  `clone`). A copy is a snapshot and a not-cloned remote cannot be edited, so neither is eligible.
- The default is `true` for the valid primary repository, `false` for every other repository.

### 3.3 Modes per placement

`modesFor(kind)` (the family list) stays as is: it defines what the schema accepts. NEW
`modesForPlacement(kind, placed: boolean): readonly ModeDef[]` gives the list the UI offers and the expander honours,
with labels/descriptions adjusted for the placed case. NEW `defaultModeFor(kind, target, placed = false)` (the
existing two-argument calls keep today's behaviour).

| Family | placed: modes (first = default) | not placed: modes (default) |
| --- | --- | --- |
| okf | `summary` labelled **"Summary + links"** ("Description, state and tags with relative links to the bundle's files; nothing inlined."), `pointer` ("One line"), `inline-main`, `inline-bundle` | `inline-main` (default), `inline-bundle`, `summary`, `pointer` (today) |
| skill | `pointer` labelled **"Link"** ("Listed with a link to its SKILL.md; the harness discovers it."), `inline` | `install` (default; `pointer` for generic), `inline`, `pointer` (today) |
| local-repo | `describe`, `tree` | `describe`, `tree` |
| remote-repo | `describe` only | `describe` (default), `clone` (commands) |
| remote-skill | `describe` only | `install` (default; `describe` for generic), `describe` |

`placed` = the recipe has an output directory (`recipe.output?.dir` set, run overrides already applied) AND the
item's resolved material is not `none`.

## 4. Recipe format (`src/datasets/schemas.ts`, `src/lib/inflate/recipe.ts`)

- `recipeOverrideSchema` gains `'edit?': 'boolean'`. The recipe narrow rejects `edit` on a key that does not start
  with `reference/` ("edit applies to repositories only"); `findings.describeIssue` keeps the wording friendly if
  needed. Run `pnpm run gen:schemas` (the committed `schemas/recipe.schema.json` changes).
- The serializer writes `edit` right after `materialOptions` in an override (fixed key order, stable diffs). An
  override that only says `edit` is kept (it sets something).
- Run overrides (`InflateRunOverrides.items[key]`) gain `edit?: boolean`; `applyRunOverrides` copies it into the
  effective recipe's override, `runOverrideCount` counts it, `parseRunRequest` accepts it, "Save to recipe" keeps it.
- No new top-level keys; no change to `.ctxman-inflate.json`.

## 5. Expansion (`src/lib/inflate/expand.ts`, PURE)

- Resolve the **material before the mode** (today it is the other way round) so the mode can depend on placement.
- `ItemSegment` gains `placed: boolean` (see §3.3) and `edit: boolean | null` (null = not eligible) plus
  `editSource: 'default' | 'override' | null`.
- Mode resolution: candidate = override ?? `defaults[kind].mode` ?? `defaultModeFor(kind, target, placed)`. A mode
  that is not in the FAMILY list keeps today's `mode-invalid` warning and fallback. A family-valid mode that is not in
  `modesForPlacement(kind, placed)` (say a stored skill `install` while the skill is symlinked) silently resolves to
  the placement default with `modeSource: 'default'`; nothing is lost, switching the material back to `none` brings
  the stored mode back.
- Edit resolution happens after the primary is validated (step 10): eligible → override.edit ?? (key is the valid
  primary); not eligible → `null` (an `edit` override on an ineligible item is ignored without a warning).

## 6. Working-directory plan and run (`material-plan.ts` PURE, `material-exec.ts`, `pipeline.ts`)

- skill `symlink`: a `symlink` step (id `skill:<key>`, label `Symlink <dest> → <source>`) to the ctxman skill
  folder at `<skillsDir>/<slug>`; recorded as a `symlink` manifest entry; cleanup and idempotency as for okf
  symlinks. skill `copy` unchanged.
- local-repo `copy`: a `copyDir` step (id `link:<key>` stays the id family for local repositories, label
  `Copy <root> → <dest>`) of the repository ROOT (same as the symlink target), with the existing copy exclusions
  (`.git`, `node_modules`, `.DS_Store`); `source-missing` rules as for symlink.
- `MaterialView` gains `edit: boolean | null`, `uriKind: 'git' | 'archive' | null`, and `owner` is `'me'` for okf
  and local skill items (ctxman data is always the user's own); references keep their `owner`.
- `gatherContent` (pipeline.ts) must also list the bundle files and compute the concept order for an okf item whose
  resolved mode is `summary` and that is placed in a directory (the "Summary + links" file list needs them).
- The `.gitignore` stub needs no change (it lists placed destinations).

## 7. LLM_CONTEXT.md (render.ts, working-directory output only)

Document-only output (no directory) is UNCHANGED, apart from mode defaults when the recipe has a directory but the
absolute document is requested (the plan is the same one).

### 7.1 Links

Every path into the working directory is a **relative markdown link** whose text is the path in a code span:
``[`kb/ctxman/index.md`](kb/ctxman/index.md)``, folders end in `/`: ``[`repos/astro-docs/`](repos/astro-docs/)``.
A destination with whitespace, `(`, `)`, `<` or `>` uses the `<…>` form. Absolute paths of items that are not placed
are links too (absolute destination). Git and https URIs stay in backticks. The `eager` pointer keeps its bare
`@path` (Claude Code) / backticked form. Add the helper to `markdown.ts` (`pathLink(path)`).

### 7.2 Section order

1. Header (as today; the working-root sentence says "Links and paths below are relative to it").
2. Preamble.
3. `## Working directory map` (as today; the note of a row names the real placement: `symlink`, `copy`,
   `git clone[, sparse][, branch x]`, `downloaded`, `cloned` (git remote skill), then `primary`, `editable`, the
   description).
4. **NEW `## Placement`**: one bullet per placement kind that occurs, plus the editable and ownership lines when they
   apply. Exact texts:
   - `- **symlink**: the original folder, live; edits change the source (your ctxman entry or local repository).`
   - `- **copy**: a snapshot taken when this directory was inflated; edits stay here and are replaced by the next inflate.`
   - `- **git clone**: a checkout of the remote repository; the next inflate pulls (fast-forward only) and keeps local changes and unpushed commits.`
   - `- **downloaded** / **cloned** skill: fetched from its URI and copied in without history; replaced by the next inflate.`
   - `- **not placed**: outside this directory; open the absolute path, or fetch the URI only when the task needs it.`
   - `- **editable** repositories may be changed for this task; **read-only** ones are reference material: read them, do not change them.` (when at least one repository is listed)
   - `- Knowledge, work items and skills from ctxman are your own notes; \`owner\` says whether a repository or remote skill is yours.` (when at least one okf or local skill item is included)
5. `## Primary repository` (when valid): title, link, key, `owner: me|not me`, `editable` or `read-only`;
   description; `- Source: …` (symlink to `<abs>` | git clone of `<uri>`, depth / branch / sparse) and
   `- Start in: <link>` when there is a subpath; last line `Work in <link> unless the task says otherwise.` when
   editable, else `Read it to answer the task; it is read-only.`.
6. `## Repositories` (all other repositories, placed or not), one bullet each:
   `- **<title>** · <link or "not cloned: \`uri\`" / "not placed: <abs link>"> · <placement phrase> · owner: <me|not me> · <editable|read-only> — <description>`,
   with `relevant path <link>` after the placement phrase when there is a subpath.
7. `## Skills` (placed first, with the target's skills intro, then "Not installed:"), one bullet each:
   `- <link to the skill folder> · **<title>** · <symlink to the ctxman skill | copy of the ctxman skill | downloaded from \`uri\` | cloned from \`uri\`> · owner: <me|not me> — <description>`.
8. The segments in plan order (context groups, additional items, markdown blocks).

### 7.3 Items inside their context group (working directory)

Every item starts with `### <title>` (level as today) and a **facts line**:
`` `<key>` · <kind label> · <state, stale, tags as today> · <link to the entry file / folder, or "not placed: <abs link>"> · <placement word> ``,
followed by the context notes (blockquotes, as today) and then:

- **okf, `summary` (placed default)**: the description, then
  `Files: <link>, <link>, …` listing the concept files (bundle order, at most 20, then `and N more in <folder link>`);
  nothing inlined. Not placed: today's summary.
- **okf, `pointer`**: today's one line, with the link.
- **okf, `inline-main` / `inline-bundle`**: today's bodies; the "More in this bundle" line and the "Other files" list
  use links.
- **skill, `pointer` (placed default)**: the description; the facts line links `<skillsDir>/<slug>/SKILL.md`.
  `inline`: today's inline body.
- **repositories and remote skills**: COMPACT, because the Primary / Repositories / Skills sections carry the
  details: the facts line (with `primary` and `editable`/`read-only` for repositories) and the notes, then
  `Details: see Primary repository.` / `see Repositories.` / `see Skills.`; a local-repo in mode `tree` still prints
  its tree here; a remote-repo that is not placed and has mode `clone` still prints its commands.
- A failed step keeps today's `Not placed in this directory: <reason>.` line.

## 8. UI (`src/ui/inflate/*`, `src/stores/inflate*.ts`)

- **Row controls** (CompositionPane → SegmentRow → OptionControls), working directory set:
  line 1 = **Place** select (materialLabel / materialDescription, `inflate-segment-material`), the material options,
  then for repositories **Primary** (`inflate-segment-primary`) and **Editable** (NEW, `inflate-segment-edit`,
  checkbox; checked by default on the primary; hidden when not eligible);
  line 2 = **In <context file>** select (`inflate-segment-mode`) listing `modesForPlacement(kind, seg.placed)`; when
  the list has one entry, show it as static text instead of a Select; then the mode's options.
  Document only: just the **Include as** select (today's family list).
- **Row head**: references show an owner badge ("mine" / "not mine"); the destination chip stays.
- **Placement summary** (NEW, `inflate-placement-summary`) at the top of the composition pane when a directory is set:
  `<dir> · 4 symlink · 1 copy · 2 clone · 1 download · 1 not placed · primary: <title> · editable: <titles>` (only
  the counts that are non-zero). Computed from the client-side plan (`$effectivePlan` / segments).
- **Sources pane defaults**: list only the item kinds present in the recipe (included or excluded items) plus any kind
  that has a stored default; each row = Place select + In LLM_CONTEXT.md / Include as select (placement-aware lists
  for the kind's default material).
- **Output**: the output directory field is visible (not collapsed) when a directory is set.
- **Run view** items: same vocabulary (Place, materialLabel) plus the Editable checkbox as a run override
  (`inflate-run-item-edit`), reset by the existing per-item reset.
- Stores: `setEdit(key, on)` (drops the override when it equals the default: on ⇔ primary), `setRunEdit(key, on)`;
  `setMode` normalisation and `baseMaterial` use the placement-aware defaults; `setPrimary` keeps working (an `edit`
  override equal to the new default may be dropped).
- Every new control has a `data-testid`; kit rules from AGENTS.md apply (kit wrappers, no raw ListBoxItem outside the
  kit, CSS in layers, no new colours outside the kit ownership rule).

## 9. Tests and docs

- Unit: catalog (materials, defaults, `materialLabel`, `modesForPlacement`, `isEditEligible`), schemas/recipe (`edit`
  parse, narrow, serialize order, run overrides), expand (material before mode, placed defaults, silent placement
  fallback, edit default/override/ineligible), material-plan (skill symlink step, local-repo copy step, views),
  material-exec (a skill symlink and a local-repo copy actually placed, re-run unchanged/replaced, cleanup), pipeline
  (summary gathers files when placed), render (links, Placement legend, owner/editable, compact repo/skill items,
  Summary + links, map notes), stores (`setEdit`, `setRunEdit`).
- E2E (`tests/e2e/inflate*.spec.ts`, `api-inflate*.spec.ts`): update for the new defaults and labels; add: the
  Editable checkbox changes the dry-run document; a symlinked skill and a cloned remote repo by default; the
  placement summary. Do not rename or add seeds (see AGENTS.md testing rules); runs only into OS temp dirs.
- Docs: `context-inflate.md` (materials table and defaults, modes per placement, Editable, the LLM_CONTEXT.md format
  with a new trimmed example, UI description), `AGENTS.md` (Inflate caveat: defaults), `log.md` of `kb/ctxman`,
  `routes-and-api.md` only if the API body changed (`edit` in run overrides: yes, mention it).
- Gate: `CTXMAN_DATA_DIR=tests/data pnpm run test:all` green.

## 10. Phases (implementation order)

| Phase | Owner files | Depends on |
| --- | --- | --- |
| A core | `catalog.ts`, `schemas.ts` (+ `gen:schemas`), `recipe.ts`, `expand.ts`, `material-plan.ts`, `material-exec.ts`, `pipeline.ts`, `findings.ts`, `collections-check.ts` (if a material/mode check needs it), their unit tests; only compile fixes elsewhere | — |
| B render | `render.ts`, `markdown.ts` (link helper), `tests/unit/inflate-render.test.ts`, `inflate-markdown.test.ts` | A |
| C UI | `src/ui/inflate/*`, `src/stores/inflate.ts`, `src/stores/inflate-run.ts`, CSS, store unit tests | A (parallel with B) |
| D integrate | e2e specs, docs, `pnpm run test:all` | B, C |

## 11. Phase A notes (core, implemented)

Deviations and additions to §3 to §6, each with its reason:

- **Run override `edit` is validated like the recipe one**: `runOverridesSchema` rejects `edit` on an item key that does
  not start with `reference/` (same message as the recipe narrow). Otherwise "Save to recipe" could turn a run override
  into an invalid recipe.
- **`.gitignore` of a symlinked skill**: git does not match a symlink with a trailing-slash pattern, so
  `gitignoreText(recipe, paths, links = [])` writes a symlinked skill destination as `/.claude/skills/<name>` (no
  slash). Copies, repositories and okf folders are unchanged (`/repos/`, `/kb/`, `/.claude/skills/<name>/`).
- **Placed okf `pointer`** keeps the label "Pointer" (description "One line with a link to the entry file."); only
  `summary` ("Summary + links") and the skill `pointer` ("Link") are relabelled. `isModeForPlacement(kind, mode,
  placed)` was added next to `modesForPlacement`.
- **Demoted views and `edit`**: when the planner demotes an item to `none`, `MaterialView.edit` is recomputed for `none`:
  `null` when `none` is not eligible (remote repo), else `true` only for an explicit `edit` override (a local repository
  at its original path), otherwise `false`. `MaterialView.uriKind` is set for remote skills only (also when not
  placed).
- **`ItemSegment.placed` is an expansion-time verdict** (directory set and material not `none`); the planner can still
  demote an item (missing tool or source, collision), so the renderer must check the `MaterialView`.
- Outside the owner files: `dir-plan.ts` `appliedOverrides` lists an item that only has `edit`; `render.ts` names a
  copied local repository and a symlinked skill correctly (map note, Repositories, Skills, "Copied to"), as the smallest
  fix for the new materials. Existing render and store unit tests were adjusted to the new defaults (pinned with explicit
  `material: none` or updated skill/pointer texts); Phases B and C rewrite them further.

## 12. Phase C notes (UI, implemented)

Deviations and additions to §8, each with its reason:

- **Rows gate on the recipe's directory, not the run override's.** `OptionControls`, the dest chip, the Sources
  defaults and the placement summary use the new `$outputDir` (the working recipe's `output.dir`), because the rows
  are the recipe's own expansion (`$plan`, whose `seg.placed` follows the recipe). Before, `$effectiveDir` (run
  override included) switched the material controls on. The Run view (`$effective*`) is unchanged.
- **Owner and URI kind come from the entry cache.** `ItemMeta` has no owner and `ManifestSegment` has no `uriKind`, so
  `$referenceInfo` (`reference/<slug>` → `{owner?, uriKind?}`, computed from `$entries`) feeds the owner badge
  (`mine` / `not mine`, test id `inflate-segment-owner`) and the manifest Material column (`materialLabel` with the
  URI kind: Clone / Download). No change to `src/lib`.
- **`cleanOverride` keeps `edit`** (it rebuilds the override from known keys; without this every later `setMode` /
  `setExcluded` would have dropped the flag). An override that only says `edit` is kept.
- **Editable store rules.** `setEdit(key, on)` drops the override when `on` equals the default (valid primary) and is
  refused when `seg.edit === null`. A stored `edit` on an item that is not editable right now (a copy, a remote
  repository that is not cloned) is kept, like a stored mode the placement does not offer: it applies again with the
  material. `tidyEdit` (after `setPrimary`, `setMaterial` and `commitWorking`, i.e. also "Save to recipe") drops the
  `edit` overrides that now equal the default; it is skipped while a lookup is loading.
- **Run Editable.** `setRunEdit(key, on)` compares with what the recipe plus every OTHER run override gives (so a run
  primary or run material is honoured), and `tidyRunEdits` (after `setRunPrimary` / `setRunMaterial`) drops run
  flags that became redundant. `setRunMaterial`'s "empty item" test includes `edit`; `resetRunItem` clears it.
- **Mode normalisation.** `setMode` uses `seg.placed`; `setDefaultMode` uses `hasDir && baseMaterial(kind) !== 'none'`;
  the base is the recipe default only when it is in `modesForPlacement`, like the expander.
- **Row layout.** With a directory: line 1 Place (+ material options, Primary, Editable), line 2 "In <context file>";
  a one-entry list is a `span` that keeps test id `inflate-segment-mode` (class `cx-seg__static`); a new
  `inflate-segment-modes` wraps line 2. Without a directory only "Include as". The branch option is hidden for a
  remote skill with an archive URI.
- **Sources defaults.** Only kinds in the recipe (included or excluded items) or with a stored default are listed;
  the Place select exists only with a directory, with a header row ("Place" / "In <file>" / "Include as"); a stored
  default mode the placement does not offer is shown as "Default (…)". The disclosure keeps the title "Default modes"
  and the ids `inflate-default-<kind>` / `inflate-default-material-<kind>`; new ids `inflate-defaults-toggle`,
  `inflate-defaults`.
- **Output panel unchanged**: its disclosure already starts expanded when `output.dir` is set (and the Sources pane
  remounts on every recipe switch).
- **`RecipeComposition.astro`** shows material labels through `materialLabel` (an override names a key, so the kind
  is derived: reference + `clone` → remote repo, `install` → remote skill "Clone or download", else local repo), an
  Editable column (`recipe-override-edit`) and an "Editable" row in the Output panel (`recipe-output-editable`: the
  primary unless `edit: false`, plus every `edit: true` override). Existing e2e text checks of the raw ids
  (`recipe.spec.ts`: `toContainText('clone')`) become `Clone`.
- New ids: `inflate-placement-summary`, `inflate-segment-edit`, `inflate-segment-owner`, `inflate-segment-modes`,
  `inflate-defaults`, `inflate-defaults-toggle`, `inflate-run-item-edit`, `recipe-override-edit`,
  `recipe-output-editable`. Kept: every other id.
- Phase D must update (labels changed): `inflate.spec.ts` "Mention only" → "Don't place", the skill row mode
  "Install" / "Pointer" → "Link", the Default modes listing (only used kinds); `inflate-run.spec.ts` "Mention only";
  `recipe.spec.ts` `'clone'` → `'Clone'`.

## 12. Phase B notes (render, implemented)

`render.ts` and `markdown.ts` (`pathLink`) follow §7. The single document without a directory is byte-identical (checked
once against the pre-change renderer over 3 targets x with/without `output.dir` x every mode x option sets, plus the
unchanged document-mode unit tests). Deviations and decisions, each with its reason:

- **"Placed" is the view's verdict**, not `ItemSegment.placed`: `dest !== null && state !== 'failed'` (`isPlacedView`). A
  demoted or failed item renders as not placed even though the expander gave it the placed mode default (okf `summary`
  without a Files line, skill `pointer` as the one-liner with an absolute link, remote skill `describe` as facts +
  Details only).
- **Manifest `modeLabel`** uses the same verdict: `modesForPlacement(kind, placed).find(mode)`, else the family label. A
  recipe WITH a directory rendered as the absolute document (`paths=absolute`) therefore keeps "Summary" / "Pointer",
  and renders okf `summary` as meta line + description (no Files list, no links): it is not placed anywhere.
- **Facts line** (`factsLine`): `key · kind · state · stale · tags · location · placement word [· primary] [· editable|
  read-only]`. `owner` and the remote-skill `git`/`archive` token are NOT repeated there (the Primary / Repositories /
  Skills sections carry them). Location = relative link (file for okf and skills, folder for repositories and remote
  skills); not placed = `not placed: <absolute link>` (repositories and remote skills without a local path:
  ``not placed: `uri` ``). Placement word: `symlink`, `copy`, `git clone`, `cloned` / `downloaded` (remote skill).
- **Link text is the full path** in `Files:`, "More in this bundle" and every other path link; the inline-bundle section
  line keeps `` `rel` · [`path`](path) `` and the "Other files" rows `` `rel` — [`path`](path) ``. Folder links end in
  `/` (also absolute ones); `<…>` destinations escape `<` and `>` with a backslash.
- **Code spans stay** for things that are not navigable targets: the working root in the header, `Source: symlink to
  <abs>` and `symlink to <abs>` / `copy of <abs>` in the Repositories bullets, URIs, the relevant path of a repository
  that is not placed, the "path does not exist" sentence, the commands of a not placed clone / install, and the map
  (a fenced block).
- **Repositories and Skills bullets have no key** any more (the plan's templates list none; the item below carries it).
  Not placed skills (the `Not installed:` list) read: title in bold, then the absolute link of the SKILL.md (local skill)
  or the URI and subpath in code spans (remote skill), then the owner and the description; a failed one starts its
  location with `not installed (reason): `.
- **Editable|read-only** (`access`): `view.edit === true`, except a remote repository that is not placed (a failed or
  demoted clone) which is read-only; a local repository keeps its flag also when its link failed or it is not placed
  (it lives at its original path). The map row note and the facts line say `editable` / `read-only` for repositories only.
- **Placement legend**: omitted when it would be empty; the remote-skill row names only the fetch kinds that occur
  (`**downloaded**`, `**cloned**` or both, in that order). "Not placed" counts every included item with a kind whose
  view has no dest or failed.
- **Compact items**: a not placed remote skill in mode `install` still prints its commands (like the not placed `clone`
  of a repository); in `describe` it is facts + `Details: see Skills.` (the former "Agent skill in the git repository ..."
  sentence is gone; the Skills list has the URI and subpath). A local repository whose path does not exist keeps its
  "does not exist on this machine" sentence. The primary points to `Details: see Primary repository.`.
- **Map notes** now say `cloned` / `downloaded` for remote skills (was `installed`) and add `editable` after `primary`.
- Document-text assertions adjusted outside the render tests: `tests/unit/inflate-dir-plan.test.ts` (two assertions that
  looked for `` `repos/astro-docs` `` now look for the folder link). Docs and e2e still quote the old wording
  (`context-inflate.md` "Relative paths below", "Installed at", "Mention only"); Phase D updates them.

## 13. Phase D notes (e2e, docs, gate)

- **Specs updated to the new behaviour** (nothing weakened): `inflate.spec.ts` (a placed bundle shows "Summary + links", so the mode-change test picks "Inline entry"; the target test shows "Link" for a placed skill in either target and checks "Install" / "Pointer" in a document-only recipe; "Mention only" is "Don't place"; the typing and Cmd/Ctrl+S tests use the clone `Branch` input because the `cloneDir` input only exists for the `clone` MODE of a document-only recipe; the mouse-selection step calls `hover()` first, since the row settles while the dry run answers), `inflate-run.spec.ts` ("Don't place", relative links in `LLM_CONTEXT.md`, `## Placement`), `api-inflate-run.spec.ts` (the skill is a symlink and `unchanged` on a re-run, link texts), `recipe.spec.ts` ("Clone", Editable column and row).
- **New coverage**: `tests/e2e/inflate-placement.spec.ts` (defaults, the Place choices incl. "Don't place" and the placement summary strip, Editable on the primary and others with the `edit` override saved / dropped, a copy hiding Editable, the recipe page flags, the Run view Editable run override with a real run and "Save to recipe"); `api-inflate.spec.ts` (`edit` accepted after `materialOptions`, 400 on a non-reference key); `api-inflate-run.spec.ts` (Editable in the plan document, 400 `invalid` for `edit` on `kb/…` for plan and run, a real run with a skill copy and a local-repository copy, replaced by the second run).
- **Renderer detail found by the specs**: the working-directory map row says `editable` only when it is (read-only is the default, not printed there); the facts line, Primary and Repositories lines always say `editable` or `read-only`.
- **No app bug found.** One observation, not changed: Playwright's `fill()` on the Branch input makes the GridList row take focus after the commit (a real user typing keeps the focus, checked with delayed typing); the specs type the text instead.
- Docs: `context-inflate.md` rewritten for v3 (Place / In LLM_CONTEXT.md, modes per placement, materials and defaults, Editable, link-based `LLM_CONTEXT.md` with a new example from a dry run), plus `routes-and-api.md`, `datasets.md`, `compliance-checks.md`, `index.md`, `log.md` of `kb/ctxman`, the feature record `inflate-working-dir` and `AGENTS.md`.
