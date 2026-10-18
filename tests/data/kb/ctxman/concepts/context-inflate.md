---
type: Concept
title: Context inflate
description: How recipes turn contexts and extra items into one markdown document, or into a working directory (items symlinked, copied, cloned or downloaded, plus an LLM_CONTEXT.md that links to them) for Claude Code, Codex or a generic agent, including the Place / In LLM_CONTEXT.md model, Editable repositories, modes, materials, targets, runs, safety rules and API.
tags: [inflate, recipe, context, agents, working-directory]
generated:
  by: claude-code/ctxman-inflate-v3-docs
  at: 2026-10-18T02:00:00Z
---

# Context inflate

A [context](/concepts/context-forge.md) is only a list of pointers. **Context inflate** is the step that reads what those pointers lead to, right now, and prepares it for a coding agent session. The tool lives at `/inflate`; the saved compositions are **recipes** (dataset `recipe`, listed at `/recipe`). The original idea record is [context-inflate](ctxman:idea/context-inflate).

Contexts stay evergreen. A recipe stores slugs, never content, and expansion happens every time you generate, so editing a linked entry or adding a link to a context changes the next output without touching the recipe.

## What it does: two outputs

1. **A document** (always available). One markdown document plus a JSON manifest, with absolute paths. Copy it, download it or write it to an absolute `.md` path. This is the "no directory" case and works without `output.dir`.
2. **A working directory** (when the recipe or the run sets a directory). A run places material in a directory `<W>` that you start your AI coding harness in: symlinks to knowledge bundles and skills, symlinked or copied local repositories, cloned remote repositories, cloned or downloaded remote skills, an `LLM_CONTEXT.md` that links to all of it (paths relative to `<W>`) and maps the directory, optional `CLAUDE.md` / `AGENTS.md` / `.gitignore` stubs, and a `.ctxman-inflate.json` file that records what ctxman owns there. Re-running updates the directory and removes what the recipe no longer places.

### Two questions per item: Place, then In LLM_CONTEXT.md

In a working directory every item answers two questions, in this order:

1. **Place** (the item's *material*): how it gets into `<W>`. Symlink, Copy, Clone, Download or Don't place.
2. **In LLM_CONTEXT.md** (the item's *mode*): how the context file presents it. An item that is placed is **referenced with relative markdown links, not inlined**, unless you ask for inlining: its files are right there, and `CLAUDE.md` loads the whole context file at the start of every session, so every inlined byte costs tokens every time. An item that is not placed keeps the document-only modes (inline, summary, install or clone commands, ...).

Repositories add two more choices: **Primary** (one per recipe; the session starts there) and **Editable** (may the session change files in it, or is it reference material). Without a directory nothing changes: only the mode applies (the UI calls it "Include as") and the defaults are the ones of the original document. The choices are stored as before (`mode`, `material`, `materialOptions`) plus one new optional override key, `edit`; every earlier recipe still parses and keeps its explicit choices, only the built-in defaults moved.

## What a recipe holds

A recipe is `recipe/<name>.yaml` in the data directory. It selects contexts, adds ad hoc items, says how each item is included and placed, fixes the order, injects your own markdown and names the output directory. The seed `ctxman-dev-brief` shows every part:

```yaml
name: ctxman-dev-brief
description: Session brief for working on ctxman itself, built from the ctxman-dev context plus the add-entry skill.
tags:
  - ctxman
target: claude-code
layout: grouped
output:
  dir: ~/ctxman-inflate/ctxman-dev-brief
  primary: reference/astro-docs
preamble: |
  You are working on ctxman, a local-only Astro app. Use pnpm only, never npm.
contexts:
  - ctxman-dev
items:
  - dataset: skill
    slug: ctxman-add-entry
markdown:
  - id: b1
    body: |
      ## Ground rules
      - Keep `AGENTS.md` current in the same change as the code.
overrides:
  - key: kb/ctxman
    mode: inline-bundle
  - key: bug/stale-badge-timezone
    exclude: true
  - key: reference/astro-docs
    mode: clone
    options:
      sparse: true
    material: clone
    materialOptions:
      subpathOnly: true
order:
  - md:b1
  - ctx:ctxman-dev
```

| Field | Meaning |
| --- | --- |
| `name`, `description` | Required. `name` equals the file stem and cannot be changed after creation. |
| `tags` | Optional; written only when non-empty. |
| `target` | `claude-code` (default), `codex` or `generic`. |
| `layout` | `grouped` (default; one `##` section per context) or `flat` (items only). |
| `output` | Optional working directory settings, see below. Absent means "document only". |
| `preamble` | Markdown placed verbatim at the top of the document, below the header. |
| `contexts` | Context slugs, in order. Always written, also as `[]`. |
| `items` | Ad hoc `{dataset, slug}` entries that are not (necessarily) linked by a context. Any dataset a context may link to; recipes cannot be linked. |
| `markdown` | Injected blocks `{id, body}`; `id` is kebab-case, new blocks are named `b1`, `b2` and so on. |
| `overrides` | Per-item `{key, mode?, options?, material?, materialOptions?, edit?, exclude?}`, where `key` is `<dataset>/<slug>`. `edit` (the Editable flag of a repository) is only valid on a `reference/<slug>` key. Entries that set nothing are dropped when saving. |
| `order` | Segment keys that pin the order (see below). Written only when non-empty. |
| `defaults` | Per item kind `{mode?, options?, material?, materialOptions?}`, keyed by `kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project`, `skill`, `local-repo`, `local-folder`, `remote-repo` or `remote-skill`. |

The `output` object:

| Key | Meaning |
| --- | --- |
| `dir` | Absolute path or one starting with `~/`. Absent means document only. A relative value is a check warning and refused at run time. |
| `contextFile` | File name of the generated document inside `dir` (a plain `*.md` name, no folders). Default `LLM_CONTEXT.md`, omitted from the file when default. |
| `primary` | `reference/<slug>` of the repository the session works on (see Materials). |
| `allowNonEmpty` | `true` lets a run use a non-empty directory that ctxman did not create. Written only when true. |
| `stubs` | `{agentsMd?, claudeMd?, gitignore?}` booleans that override the target's defaults; only given keys are written. |

Segment keys are `<dataset>/<slug>` for an item, `md:<id>` for a markdown block, `ctx:<slug>` for a context heading and the fixed `sec:extra` for the "Additional items" heading.

The schema is strict: unknown keys are errors, duplicates (contexts, items, block ids, override keys, order keys) are errors, and a mode or material that does not apply to the item kind is an error. The serializer writes a fixed key order (`name, description, tags, target, layout, output, preamble, contexts, items, markdown, overrides, order, defaults`), so saving through the UI or API gives stable diffs.

## Expansion rules (evergreen)

Expansion is a pure function (`src/lib/inflate/expand.ts`) shared by the server and the Inflate island:

1. Contexts are read in recipe order. A missing or invalid context becomes a warning and is skipped.
2. Every link of every ready context registers an item the first time it is seen. An item linked by two contexts appears once, under the first one; the notes of every context that links it are kept, in context order, and the `via` list names them all.
3. Ad hoc `items` are added after the links. An item that is both linked and ad hoc is still a single segment.
4. Default order, grouped layout: for each context its `## Context:` heading followed by the items it owns, then `## Additional items` with the ad hoc items no context links, then the markdown blocks. Flat layout: items in first-seen order, then the blocks. A context heading also names the items it links that appear in another section ("Also relevant here").
5. `order` is applied on top: keys listed keep your order, keys that no longer exist are ignored, and a key the recipe has never seen (a link added to a context later) is inserted right after its default predecessor. New links therefore show up without editing the recipe.
6. A missing or unreadable item is skipped with a warning; the document still renders.
7. `overrides` with `exclude: true` drop an item. An override whose key matches nothing in the recipe is stale: it is ignored with a warning.
8. Material and material options resolve in layers: built-in default for the item kind (see Materials), then `defaults[kind]`, then the item's override. An invalid one falls back with a `material-invalid` warning. The material is resolved **before** the mode, because it decides whether the item is placed.
9. An item is **placed** when the recipe has `output.dir` (run overrides are applied before expansion) and its material is not `none`. Mode and options resolve next: built-in default for the kind, target and placement, then `defaults[kind]`, then the item's override. A mode of another item family falls back with a `mode-invalid` warning. A mode of the right family that the placement does not offer (a stored skill `install` while the skill is symlinked) silently resolves to the placement default; it stays in the recipe and applies again when the material goes back to Don't place.
10. `output.primary` is checked after expansion: it must be an included remote-repo item with material `clone` or a local-repo item with material `symlink`, otherwise a `primary-invalid` warning is added and the recipe has no primary.
11. **Editable** is resolved last, for the repositories that can be edited (see Materials): `override.edit`, else true for the valid primary and false for every other repository. All other items have no flag. An `edit` stored for an item that cannot be edited right now (a copy, an uncloned remote) is kept and ignored without a warning, like a stored mode the placement does not offer.

## Brief quality

The inline modes shape each entry body so the document is a usable brief and not a pile of template headings:

* **Defaults**: in a document, and for an item that is not placed, every okf kind (kb, rca, idea, task, bug, feature, project) defaults to `inline-main`. Use `summary` or `pointer` per kind or per item when a short brief is wanted. An item that is placed in a working directory defaults to `summary` ("Summary + links"): its files are linked, not inlined.
* **Description**: an inline okf item (`inline-main` or `inline-bundle`) prints its frontmatter `description` ahead of the body when the description is not already part of the body (compared ignoring case and whitespace). The same text is what `summary` shows.
* **Empty sections dropped**: an ATX heading with nothing under it (end of text, or a heading of the same or a higher level next) is removed, repeatedly, so the empty `## Steps` of a fresh task disappears together with sections that only held empty subsections. Code blocks are never touched.
* **Markdown blocks** nest under their group: `###` inside a context group, `##` outside one, a block whose shallowest heading is above that level is shifted down to it, deeper headings are left alone. The manifest titles a block by its first heading, else `Markdown <id>`.
* **Unresolved links**: with `rewriteLinks`, a bundle link to a file the bundle does not have, a link that leaves the bundle, a `ctxman:` link whose entry does not exist and a malformed `ctxman:` link are left as written and add an `unresolved-link` warning naming the item, file and destination. The warnings are de-duplicated like the others.

## Include modes

The **mode** says how the document presents an item. Which modes exist depends on the item kind **and on whether the item is placed** (a working directory is set and its material is not `none`). The first mode of a list is its default.

| Item kind | Not placed (a document, or Don't place) | Placed in a directory |
| --- | --- | --- |
| `kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project` | `inline-main`, `inline-bundle`, `summary`, `pointer` | `summary` ("Summary + links"), `pointer`, `inline-main`, `inline-bundle` |
| `skill` | `install` (`pointer` for the generic target), `inline`, `pointer` | `pointer` ("Link"), `inline` |
| reference `local-repo`, `local-folder` | `describe`, `tree` | `describe`, `tree` |
| reference `remote-repo` | `describe`, `clone` | `describe` |
| reference `remote-skill` | `install` (`describe` for the generic target), `describe` | `describe` |

The schema accepts every mode of the family in either case; a stored mode the placement does not offer is not applied (see Expansion rules). The UI offers only the list that fits, and shows a one-entry list as plain text.

What each mode writes:

| Mode | Output |
| --- | --- |
| `inline-main` | The entry's `index.md` body (the id stays `inline-main`, shown as "Inline entry"), plus a line listing the bundle's other concept files (relative links when placed, paths otherwise). The entry's `description` is printed first when the body does not already contain it, so a task or project whose template body is empty still says what it is. |
| `inline-bundle` | `index.md` (the entry), then every concept file under its own heading, in `index.md` order, then non-markdown files as a path list. |
| `summary` | Not placed: meta line plus the description. Placed ("Summary + links"): the description and a `Files:` line with relative links to the bundle's concept files (at most 20, then "and N more in" the folder link); nothing is inlined. |
| `pointer` (okf) | One line with the description and the path to read (a link when placed). |
| `install` (skill) | Not placed only: a shell block that copies (or symlinks) the skill folder into the target's skills directory. |
| `pointer` (skill) | Not placed: description plus the `SKILL.md` path. Placed ("Link"): the description; the facts line links `<skillsDir>/<slug>/SKILL.md`, which the harness discovers by itself. |
| `inline` (skill) | `SKILL.md` body plus a list of the skill's other files. |
| `describe` | Description and where the thing is (path or URI). |
| `tree` | `describe`, then the top-level entries of the local path (`treeLimit`). |
| `clone` | Not placed only: `git clone` commands into the project. |
| `install` (remote-skill) | Not placed only: commands that clone or download the skill into the skills directory. |

**Reference info.** Whatever the mode, a reference with an `info` (markdown in the reference file) gets it inlined under its item: after the description in the single document, between the facts line (and context notes) and the `Details:` line in a working directory. Its headings are nested below the item heading, and `ctxman:` links are resolved like in inline bodies (relative links when the target is placed); other links stay as written, since a reference has no bundle. A `ctxman:` link that does not resolve adds an `unresolved-link` warning. The Primary repository, Repositories, Folders and Skills sections stay one-liners and do not repeat it.

Options a mode accepts (others are ignored and not stored):

| Option | Control | Default | Used by |
| --- | --- | --- | --- |
| `includeFrontmatter` | checkbox | off | `inline-main`, `inline-bundle`, skill `inline` |
| `includeLog` | checkbox | off | `inline-bundle` |
| `shiftHeadings` | checkbox | on | the inline modes: nests the item's headings under its section |
| `rewriteLinks` ("Resolve links") | checkbox | on | the inline modes: bundle and `ctxman:` links become file paths (relative to the directory when the item is placed in one, absolute otherwise) |
| `eager` | checkbox | off | `pointer`: load the file up front (see targets) |
| `symlink` | checkbox | off | skill `install` (the commands) |
| `treeLimit` | select 10, 25, 50, 100, 200, 500 | 50 | `tree` |
| `cloneDir` | text | `.ctxman/refs/{name}` | `clone`; project-relative, letters, digits, `. _ -` and `/`, no `..`; `{name}` is the reference name |
| `shallow` | checkbox | on | `clone`: `--depth 1` |
| `sparse` | checkbox | off | `clone`: sparse checkout of the reference's `subpath` |

In a working-directory document an item the run placed never prints install or clone commands: its facts line says how it was placed and links to it, whatever the stored mode. A remote repository or skill that is **not** placed (Don't place, or its step failed) keeps its commands when its mode is `clone` / `install`, and an item whose step failed says `Not placed in this directory: <reason>.`

## Materials: what a run places in the directory

The material of an item is independent of its mode, and it comes first: it decides whether the item is placed, which in turn decides which modes apply. The same catalog (`src/lib/inflate/catalog.ts`) drives the UI, the planner and the checks. In the UI the material is the **Place** select; `none` reads **Don't place**.

| Item kind | Place (materials, first = default) | Destination in `<W>` |
| --- | --- | --- |
| `kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project` | Symlink (`symlink`), Copy (`copy`), Don't place (`none`) | `<dataset>/<slug>` |
| `skill` | Symlink, Copy, Don't place | `<skillsDir>/<slug>` |
| reference `local-repo` | Symlink, Copy, Don't place | `repos/<slug>` |
| reference `local-folder` | Symlink, Copy, Don't place | `folders/<slug>` |
| reference `remote-repo` | Clone (`clone`), Don't place | `repos/<slug>` |
| reference `remote-skill` | Clone for a git URI or Download for an archive (`install`), Don't place | `<skillsDir>/<last subpath segment, or the slug>` |

The defaults are the same for every target (the target only decides `<skillsDir>`): knowledge, skills, local repositories and local folders are symlinked, remote repositories and remote skills are fetched. `install` of a remote skill is labelled by the URI kind (Clone, Download, or "Clone or download" while the kind is unknown). Don't place means nothing is placed and `LLM_CONTEXT.md` points at the original path or URI.

* **Symlink** links the folder to the original (a ctxman entry, a ctxman skill folder, the repository root or the local folder; on Windows a junction). Edits through the link change the source, and a re-run leaves it `unchanged`.
* **Copy** is a snapshot made through a temporary sibling and a rename, so files removed from the source disappear on the next run (it is `replaced` every run). `.git`, `node_modules` and `.DS_Store` are not copied, so a copied repository has no history and can be neither primary nor editable.
* **Clone** runs `git clone` into `repos/<slug>` and `git pull --ff-only` on later runs. Options: `cloneDepth` (1, 10, 50 or 0 for full history; default 1), `branch` (a branch or tag; default the remote's default branch) and `subpathOnly` (a sparse checkout of the reference's `subpath`; offered in the UI only for a reference that has a subpath).
* **Clone or Download** (remote-skill `install`): a git URI is cloned shallowly into the stage folder `.ctxman-tmp/<slug>` (sparse when there is a subpath), an https archive is downloaded (limit 256 MiB, 10 minutes) and extracted with the system `tar`. The skill folder is then located (the subpath, else `SKILL.md` at the root, else the single wrapper folder of an archive), copied to the destination without symbolic links, and the stage folder is removed. The destination folder name is the last subpath segment when that is a valid entry name (so `skills/skill-creator` installs as `skill-creator`, as agentskills.io requires the folder to equal the skill name), else the reference slug. The branch option does not apply to an archive.
* **Primary repository**: `output.primary` names one `reference/<slug>`, a remote-repo with `clone` or a local-repo with `symlink` (never a `local-folder`: it is not a git repository). The document then leads with a "Primary repository" section (source, a "Start in" link when the reference has a subpath, and "Work in `repos/<slug>` unless the task says otherwise"). It is single-select in the UI: ticking Primary on another item moves it.
* **Editable**: whether the session may change files in a repository or local folder. Eligible: a `local-repo` or `local-folder` that is symlinked or not placed (it lives at its original path) and a cloned `remote-repo`. A copy is a snapshot that the next run replaces, and a remote repository that is not cloned has nothing to edit, so neither has the flag. The default is **on for the valid primary and off for every other repository and folder**. It is stored as the `edit` field of the `reference/<slug>` override (only a value that differs from the default is kept; the override is invalid on any other key), or given for one run as a run override. The document says `editable` or `read-only` for every repository and folder, the Placement legend says what that means, and a read-only primary ends with "Read it to answer the task; it is read-only." instead of "Work in ...". Editable is guidance for the agent: nothing is made read-only on disk.

A material that cannot be placed is demoted to `none` with a warning and nothing is done for it: `dest-collision` (two items want the same destination; the first wins), `source-missing` (a local repository or folder path, or an unknown URI kind), `tool-missing` (git, or tar / unzip for an archive, is not installed). The renderer follows the outcome, not the intention: a demoted or failed item is written as not placed.

## Targets

| | `claude-code` | `codex` | `generic` |
| --- | --- | --- | --- |
| Label | Claude Code | Codex | Generic agent |
| Skills directory | `.claude/skills` | `.agents/skills` | `.agents/skills` |
| Instructions file named in the header | `CLAUDE.md` | `AGENTS.md` | none (no skills line) |
| `eager` pointer | `Read it before starting: @/abs/path` | ``Read `/abs/path` before starting.`` | same as codex |
| Default skill mode (not placed) | `install` | `install` | `pointer` |
| Default remote-skill mode (not placed) | `install` | `install` | `describe` |
| Stub written by default | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |

Everything else is identical across targets; `.gitignore` is a default stub for all of them. A placed skill (`pointer`) and a placed remote skill (`describe`) have the same default in every target. Only an `eager` pointer uses the bare `@path` form, because Claude Code loads a file the moment it sees `@path`; every other path is in backticks (or, in a working-directory document, a markdown link whose text is the backticked path), which suppresses that expansion.

## Output format

### The document (no directory)

The document is the header, the preamble (if any) and then the segments, separated by blank lines:

~~~~markdown
# ctxman-dev-brief

> Prepared by ctxman for a Claude Code session.
> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.
> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.

You are working on ctxman, a local-only Astro app.

## Context: ctxman-dev

Everything an agent needs to work on ctxman itself.

### ctxman

`kb/ctxman` · Knowledge Base · tags: ctxman · `/abs/data/kb/ctxman/index.md`

> **From context `ctxman-dev`:** Start here.

What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.

...the entry body, headings shifted below the item heading...

## Additional items

### ctxman-add-entry

`skill/ctxman-add-entry` · Skill · `/abs/data/skill/ctxman-add-entry`

Install this skill into the project (run from the project root):

```sh
mkdir -p .claude/skills
cp -R /abs/data/skill/ctxman-add-entry .claude/skills/ctxman-add-entry
```
~~~~

Details:

* Heading levels: context and "Additional items" headings are `##`; an item is `###` in the grouped layout (`##` when it sits outside a context group or the layout is flat); the item's own headings are shifted below it. A leading H1 that repeats the entry title is dropped.
* The meta line is the item key, the kind label, then state, stale marker, owner, tags and location when they apply.
* Context notes become `> **From context ...:**` blockquotes ahead of the item body.
* Resolved links: with `rewriteLinks`, `/concepts/x.md`, relative `./x.md` and `ctxman:` links become file paths (the link text stays), so the agent can open them directly. Links inside code are untouched and unresolvable targets are left as written.
* Shell commands quote every value, fenced blocks grow their fence when the content contains backticks, and `.ctxman/` is the scratch directory for clones and downloads inside the project (keep it out of version control).
* The manifest returned with the document lists every segment with key, kind, mode, options, `via`, source path, bytes and status (`included`, `excluded`, `missing`, `invalid`), plus counts, contexts, total bytes and de-duplicated warnings. Warning codes: `context-missing`, `context-invalid`, `item-missing`, `item-invalid`, `mode-invalid`, `override-stale`, `path-missing`, `file-unreadable`, `unresolved-link` and `large-output` (over 512 KB), and for working directories `material-invalid`, `primary-invalid`, `dest-collision`, `source-missing`, `tool-missing`, `manifest-unreadable`, `manifest-other-recipe` and `context-file-edited`. With a directory the manifest also has `output` (`dir`, `contextFile`, `primary`) and each placed item has `material` and `dest`.

### LLM_CONTEXT.md (working directory)

The file written by a run (and the relative document of the Preview and of `POST /api/inflate/plan`) is the same brief with every path into `<W>` turned into a **relative markdown link** and the placement spelled out. The generation time is NOT printed, so an unchanged recipe produces an identical file.

**Links.** The link text is the path in a code span and a folder ends in `/`: ``[`kb/ctxman/index.md`](kb/ctxman/index.md)``, ``[`repos/astro-docs/`](repos/astro-docs/)``. A destination with whitespace, parentheses or angle brackets uses the `<...>` form. A path outside `<W>` (an item that is not placed) is an absolute link; a symlink target and the working root stay in code spans; git and https URIs stay in code spans. Only an `eager` pointer keeps a bare `@path` (Claude Code), so nothing else is force-loaded.

Section order:

1. Header: the title, the session line, a note that `<W>` is the working root (printed once, the only absolute path of the directory; "Links and paths below are relative to it"), the skills line, and which stub loads the file.
2. The preamble.
3. `## Working directory map`: a `text` block listing the context file and stubs, then one group per folder (`repos/`, `folders/`, one per knowledge dataset, the skills directory) with what each entry is (`symlink`, `copy`, `git clone[, sparse][, branch x]`, `cloned` / `downloaded` for a remote skill), a `primary` and an `editable` marker (read-only is the default and not repeated) and the first words of its description.
4. `## Placement`: a legend with one line per placement kind that occurs (**symlink**, **copy**, **git clone**, **downloaded** / **cloned** skill, **not placed**), what **editable** and **read-only** mean when a repository or folder is listed (the line names "repositories", "folders" or both), and a line saying that ctxman knowledge, work items and skills are the user's own notes (`owner` says whether a repository or remote skill is theirs).
5. `## Primary repository` (only with a valid primary): title, link, key, `owner: me|not me`, `editable` or `read-only`; the description; `Source:` (symlink to a path, or git clone of a URI with depth, branch and sparse path); `Start in:` as a link when the reference has a subpath; and the closing line (`Work in <link> unless the task says otherwise.` or `Read it to answer the task; it is read-only.`).
6. `## Repositories`: every other repository, placed or not, one bullet each: title, link (or `not cloned` / `not placed` with the URI or absolute link), the placement phrase, `owner`, `editable` or `read-only`, the description.
7. `## Folders`: every local folder (a plain folder, not a git repository), placed or not, with the same bullet as a local repository.
8. `## Skills`: the placed skills first, under a line naming the skills directory (a link to the skill folder, the title, `symlink to the ctxman skill` / `copy of the ctxman skill` / `downloaded from <uri>` / `cloned from <uri>`, `owner`, the description), then a "Not installed:" list.
9. The segments in plan order. An item starts with a **facts line**, `` `key` · kind · state, stale, tags · link to the file or folder (or "not placed: <absolute link>") · placement word [· primary] [· editable | read-only] ``, then the context notes (as blockquotes) and the content of its mode: an okf `summary` prints the description and the `Files:` links (at most 20, then "and N more in <folder>"), a skill in `pointer` mode the description, the inline modes the bodies (the "More in this bundle" and "Other files" lists use links). **Repositories, local folders and remote skills are compact**: the facts line and the notes, the reference's `info` when it has one, then `Details: see Primary repository.` / `see Repositories.` / `see Folders.` / `see Skills.`, because those sections carry the details; a local repository or folder in `tree` mode still prints its tree. An item that failed during the run is written as not placed, with the reason.

A trimmed example, generated by a dry run of the seed recipe with two extra items (the local repository `ctxman-repo` and the remote skill `anthropic-skills`) and without the seed's `inline-bundle` override of `kb/ctxman` (`<W>` = `~/ctxman-inflate/ctxman-dev-brief`, the Astro docs cloned as primary and editable, the local repository read-only; `...` marks cut text):

~~~~markdown
# ctxman-dev-brief

> Prepared by ctxman for a Claude Code session.
> This directory is the working root (`/Users/me/ctxman-inflate/ctxman-dev-brief`). Links and paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.
> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.
> `CLAUDE.md` in this directory loads this file.

You are working on ctxman, a local-only Astro app. Use pnpm only, never npm.

...

## Working directory map

```text
LLM_CONTEXT.md                    this file
CLAUDE.md                         loads this file
.gitignore                        ignores the machine-specific paths below
repos/
  astro-docs/                     git clone, sparse · primary · editable · The Astro documentation source, English content. Consul…
  ctxman-repo/                    symlink · This repository on the local machine, the home of the c…
kb/
  ctxman/                         symlink · What ctxman is, how it is built, and how to work with i…
  astro-content-layer/            symlink · How Astro 7 content collections, loaders and schemas wo…
  ...
.claude/skills/
  okf-authoring/                  symlink · Author and review OKF v0.2 knowledge bundles (kb, rca,…
  ctxman-add-entry/               symlink · Create a new ctxman dataset entry (kb, rca, idea, task,…
  skill-creator/                  cloned · Anthropic's public skills repository; the skill-creator…
```

## Placement

- **symlink**: the original folder, live; edits change the source (your ctxman entry or local repository).
- **git clone**: a checkout of the remote repository; the next inflate pulls (fast-forward only) and keeps local changes and unpushed commits.
- **cloned** skill: fetched from its URI and copied in without history; replaced by the next inflate.
- **editable** repositories may be changed for this task; **read-only** ones are reference material: read them, do not change them.
- Knowledge, work items and skills from ctxman are your own notes; `owner` says whether a repository or remote skill is yours.

## Primary repository

**astro-docs** · [`repos/astro-docs/`](repos/astro-docs/) · `reference/astro-docs` · owner: not me · editable

The Astro documentation source, English content. Consult it for content collections, loaders, routing and configuration.

- Source: git clone of `https://github.com/withastro/docs.git`, shallow (depth 1), sparse checkout of `src/content/docs/en`
- Start in: [`repos/astro-docs/src/content/docs/en/`](repos/astro-docs/src/content/docs/en/)

Work in [`repos/astro-docs/`](repos/astro-docs/) unless the task says otherwise.

## Repositories

- **ctxman-repo** · [`repos/ctxman-repo/`](repos/ctxman-repo/) · symlink to `/Users/me/repos/ctxman` · owner: me · read-only — This repository on the local machine, the home of the ctxman app, its scripts and all datasets.

## Skills

Installed in `.claude/skills/`, where Claude Code discovers them.

- [`.claude/skills/okf-authoring/`](.claude/skills/okf-authoring/) · **okf-authoring** · symlink to the ctxman skill · owner: me — Author and review…
- [`.claude/skills/skill-creator/`](.claude/skills/skill-creator/) · **anthropic-skills** · cloned from `https://github.com/anthropics/skills.git`…

...

## Context: ctxman-dev

Everything an agent needs to work on ctxman itself, from architecture and datasets to open work and sources of truth.

### ctxman

`kb/ctxman` · Knowledge Base · tags: ctxman, architecture, docs · [`kb/ctxman/index.md`](kb/ctxman/index.md) · symlink

> **From context `ctxman-dev`:** Start here. Read the architecture and datasets concepts before touching code or data.

What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.

Files: [`kb/ctxman/concepts/mcp.md`](kb/ctxman/concepts/mcp.md), [`kb/ctxman/concepts/datasets.md`](kb/ctxman/concepts/datasets.md), …

...

### okf-authoring

`skill/okf-authoring` · Skill · [`.claude/skills/okf-authoring/SKILL.md`](.claude/skills/okf-authoring/SKILL.md) · symlink

> **From context `ctxman-dev`:** Follow its checklist whenever you edit markdown under `data/`.

Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature and project entries) under ctxman's data/ directory. Use when…

...

### astro-docs

`reference/astro-docs` · Remote repo · tags: astro, docs · [`repos/astro-docs/`](repos/astro-docs/) · git clone · primary · editable

> **From context `ctxman-dev`:** Upstream Astro docs; the content collection pages live under `guides/` and `reference/`.

Details: see Primary repository.

...
~~~~

### Stubs

* `CLAUDE.md` (default for `claude-code`): a title, one sentence naming the recipe and the context file, and a bare `@LLM_CONTEXT.md` line, which Claude Code loads at session start.
* `AGENTS.md` (default for `codex` and `generic`): the same sentence, "read it first", and a note that paths are relative to the directory.
* `.gitignore` (default for all): `/.ctxman-inflate.json`, `/.ctxman-tmp/` and the folders that hold placed material (`/repos/`, `/folders/`, `/kb/`, `/.claude/skills/<name>/`, ...), so the directory can be a git repository of your own notes without committing machine-specific content. A symlinked skill is listed without the trailing slash (`/.claude/skills/<name>`), because git does not match a symlink with a directory pattern.

Stubs are only written when absent or when the file still has the hash ctxman recorded; an edited or foreign stub is kept and reported. `LLM_CONTEXT.md` is output: it is always regenerated, with a warning (`context-file-edited`) when local edits are replaced. A stub whose name equals the context file name (case-insensitive) is not written.

## Working directory runs

### Plan, run, jobs

1. **Plan** (`POST /api/inflate/plan`, a dry run, nothing is written). The server applies the run overrides, expands the recipe, checks the directory, looks at what is in it (including its manifest), probes for git, tar and unzip, and returns the blocking problems, the warnings, the ordered steps, and the relative document as a run would write it. The Run view shows this 400 ms after any change.
2. **Run** (`POST /api/inflate/run`) plans again, refuses on a blocking problem, and starts the steps in the background. It answers 202 with the job. Only one run can be active (409 `busy`).
3. **Jobs** (`GET /api/inflate/jobs/<id>`): the UI polls every 500 ms. A job has a status (`queued`, `running`, `done`, `failed`, `cancelled`), its steps with a status each, the last 20 output lines of every step and a summary. `POST /api/inflate/jobs/<id>/cancel` aborts the running process and skips the rest. Jobs live in server memory: the last 20 finished jobs are kept and all are lost when the server restarts (the page then says the run is no longer known). `?view=run&job=<id>` resumes watching after a reload.

Steps run in this order, with these ids (the seed's dry run has 15):

| Id | What it does |
| --- | --- |
| `dir` | Create the directory (or use the existing one). A failure aborts everything else. |
| `rm:<path>` | Remove a path the previous manifest lists and the new plan no longer places. |
| `okf:<key>`, `skill:<key>`, `link:<key>` | Symlink or copy knowledge bundles, symlink or copy skills, symlink or copy local repositories (then local folders). |
| `clone:<key>` | `git clone` (or `git pull --ff-only` when the same clone exists). |
| `stage:<key>`, `dl:<key>`, `x:<key>`, `skill:<key>` | Remote skill: clone or download into `.ctxman-tmp/`, extract, place. |
| `stage-cleanup` | Remove `.ctxman-tmp/`. |
| `context`, `stub:<file>` | Write the context file and the stubs. |
| `manifest` | Write `.ctxman-inflate.json`. |

A step ends `ok`, `unchanged`, `skipped` (a dependency failed, or something was deliberately kept), `failed` or `cancelled`. A failed item does not stop the others; the context file is then rendered for what actually happened. `stage-cleanup` and `manifest` always run, also after a cancel, so the manifest matches the disk.

### Idempotency

A second identical run changes nothing it does not have to: links are `unchanged` (an identical symlink ctxman did not record is adopted), copies are replaced (to drop files removed from the source), clones pull (`updated` or `unchanged`), the context file and stubs are `unchanged` when the text is identical. Only the generation time and job id in the manifest differ.

### `.ctxman-inflate.json`

The ownership record, JSON with 2-space indentation: `format: "ctxman-inflate"`, `version: 1`, `recipe`, `target`, `contextFile`, `generatedAt`, `jobId` and `entries`, sorted by path. Each entry has a posix `path` relative to `<W>` and a `type`:

```json
{ "path": "kb/ctxman", "type": "symlink", "key": "kb/ctxman", "target": "/Users/me/repos/ctxman/data/kb/ctxman" }
{ "path": ".claude/skills/okf-authoring", "type": "copy", "key": "skill/okf-authoring", "source": "/Users/me/repos/ctxman/data/skill/okf-authoring" }
{ "path": "repos/astro-docs", "type": "clone", "key": "reference/astro-docs", "uri": "https://github.com/withastro/docs.git", "branch": null, "depth": 1, "sparse": "src/content/docs/en" }
{ "path": "CLAUDE.md", "type": "file", "role": "claude-md", "sha256": "..." }
```

Also `skill` entries (an installed remote skill: `uri`, `subpath`) and the other file roles (`context`, `agents-md`, `gitignore`). A symlinked skill, local repository or local folder is a `symlink` entry, a copy a `copy` entry. Every path in it must be relative, free of `..` and `.git` segments and not the manifest itself, or the file is treated as unreadable.

### Cleanup rule

ctxman deletes or replaces ONLY paths recorded in the previous manifest. A recorded path is removed when (a) the new plan does not own it any more, (b) it is still what ctxman created (a symlink is still a symlink, a copy a real folder, a clone a git checkout, a file a file) and (c) it carries nothing of yours: a clone has no uncommitted changes and nothing unpushed, a file still has the recorded sha256. Anything else is kept and reported (`kept <path>: it has local changes or unpushed commits`, `edited since ctxman wrote it`, `no longer what ctxman created`). Symlinks are unlinked, never followed, so the ctxman entry behind a link is never touched. Nothing outside recorded paths is ever removed, and an existing path that is not recorded is a conflict (`exists and was not created by ctxman`), not an overwrite. A directory last inflated from a different recipe gets a `manifest-other-recipe` warning with the number of paths that will go.

### Safety rules

* The directory must be absolute or start with `~/` (`~user` is refused), must not be a filesystem root or your home directory, must not contain or be inside the ctxman repository or the data directory and must not have a `node_modules` or `.git` segment. The real path of an existing directory (a symlink) is checked again against the same rules.
* A directory that exists and is not empty (apart from `.DS_Store`, `Thumbs.db`, `desktop.ini`) needs a readable ctxman manifest or `allowNonEmpty`. An unreadable manifest with `allowNonEmpty` runs with nothing removed (`manifest-unreadable`).
* Every step target is joined with `safeJoin` and the real path of its parent must stay inside the real path of `<W>`.
* Processes are spawned with an argument list and no shell. Git runs with `GIT_TERMINAL_PROMPT=0` and `ssh -o BatchMode=yes` (a missing credential fails fast instead of hanging), with a 15 minute limit; extraction has 5 minutes. Archive members are extracted by the system tools, which refuse absolute and `..` members; symbolic links are dropped from installed skills.
* Needed tools: `git` for clone and git skills; `tar` (bsdtar on macOS and Windows 10+, GNU tar on Linux) for archives, with `unzip` as the fallback for `.zip` (GNU tar cannot read zip). A missing tool demotes only the items that need it. Windows is not tested: directory links are junctions (no administrator rights needed) and removal falls back to `rmdir`.
* Tests and experiments never run against a recipe's own directory (the seed's is `~/ctxman-inflate/ctxman-dev-brief`): they pass a run override `dir` under the OS temp directory, and the end-to-end suite reaches a local git fixture through git's `insteadOf` config and slows every step with `CTXMAN_INFLATE_STEP_DELAY_MS` (a test hook, 0 to 5000 ms) so a cancel can land mid-run.

## Run overrides

A run can change settings without editing the recipe. The Run view sends them next to the working recipe and the server applies them before anything else (`applyRunOverrides`, a pure function), so the planner, renderer and checks only ever see one effective recipe. Overridable: `dir`, `contextFile`, `primary` (including "none"), `allowNonEmpty`, and per item `material`, `materialOptions` and `edit` (the Editable flag; like in the recipe only on `reference/<slug>` keys, 400 `invalid` otherwise). A value equal to the recipe's removes the override. The banner "N run overrides (not saved)" offers **Save to recipe** (the overrides become ordinary edits of the recipe, which you then save) and **Clear**; each item row has a reset. Unsaved recipe edits are included in a run: the working copy is what is sent, not the file.

## API

All routes use the shared JSON conventions (see [Routes and API](/concepts/routes-and-api.md)): `no-store`, `{error, message, issues?}` errors, 415 for non-JSON, 403 for a foreign `Origin`, 405 for another method.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/recipe/<slug>` | Read a recipe: `{ recipe, lastModified }`. |
| `POST /api/recipe` | Create a recipe (201 with `Location: /recipe/<name>`, 409 if it exists). |
| `PUT /api/recipe/<slug>` | Replace a recipe; `name` must equal the slug (400 `name-mismatch` otherwise). |
| `DELETE /api/recipe/<slug>` | Delete a recipe (204). |
| `POST /api/inflate/render` | Body is a recipe, saved or not. Returns `{ markdown, manifest }` with absolute paths (the output directory is ignored); 400 `invalid` with `issues` when the recipe fails its schema. Nothing is written. |
| `POST /api/inflate/write` | Body `{ recipe, path }`. Renders, writes the markdown to `path`, returns `{ path, bytes, manifest }`. Errors: 400 `invalid` (recipe issues are prefixed `recipe.`), 400 `bad-path`, 400 `write-failed`. |
| `POST /api/inflate/plan` | Body `{ recipe, overrides? }` (`overrides`: `{ dir?, contextFile?, primary?, allowNonEmpty?, items? }`, where `items[key]` is `{ material?, materialOptions?, edit? }`). Dry run: `{ dir, dirInput, contextFile, dirState, blocking, steps, warnings, document, applied }`. A bad directory is a `blocking` entry (`bad-dir`, `dir-not-directory`, `dir-not-empty`, `manifest-invalid`), not an HTTP error; with no directory the document is the absolute one and `steps` is empty. 400 `invalid` for a bad body. |
| `POST /api/inflate/run` | Same body. 202 `{ jobId, job }` with `Location: /api/inflate/jobs/<id>`. 400 `no-dir`, `bad-dir`, `dir-not-directory`; 409 `dir-not-empty`, `manifest-invalid`, `busy` (with the running `jobId`). |
| `GET /api/inflate/jobs/<id>` | The job (`InflateJob`). 400 `bad-id`, 404 `not-found` (unknown or lost in a restart). |
| `POST /api/inflate/jobs/<id>/cancel` | Empty body or `{}`. 200 `{ job }` (status `running` with `cancelRequested`, or `cancelled`); 409 `not-running` for a finished job. |
| `POST /api/ide/open` with `{ dir }` | Open an inflated directory (one holding a valid manifest) as an IDE workspace; 400 `bad-path`, 404 `not-found`. |

There is no options endpoint: the modes, materials, targets and options tables live in the pure module `src/lib/inflate/catalog.ts`, which the island imports directly.

### Write-path safety (document mode)

`/api/inflate/write` is the only place besides a directory run where the tool writes outside `recipe/` in the data directory. The path must pass these rules (first failure wins):

1. A non-empty string of at most 1024 characters without NUL.
2. Absolute (relative paths are refused, so the output never lands somewhere implied by the server's working directory).
3. Ends in `.md`.
4. No `node_modules` or `.git` segment.
5. Not inside the data directory, so output can never overwrite a dataset.

The file is written to a temporary sibling and renamed, parent directories are created, and an existing directory at the path is refused. Paths outside the home directory are allowed (the end-to-end tests write under the OS temp directory). The default target in the UI is `out/<recipe>.md` in the repo, which is gitignored and ignored by the linter and formatter.

## The /inflate page

One React island with three views, selected by the URL parameter `view`:

* **Compose** (default). A sources pane (description, an **Output directory** disclosure with the directory field, "Use default" (`~/ctxman-inflate/<name>`), "Document only", context file, the three stub checkboxes and "Allow a non-empty directory"; preamble editor, contexts to tick, **Default modes**, ad hoc search and "+ Markdown block") and a composition pane. The disclosure starts open when a directory is set. **Default modes** lists only the item kinds the recipe has (included or excluded items, plus any kind with a stored default), one row each: with a directory a **Place** select (the default material, "Default (Symlink)" and so on) and an **In LLM_CONTEXT.md** select, without one an **Include as** select. The composition pane starts, when a directory is set, with the **placement summary** (`~/ctxman-inflate/x · 4 symlink · 1 copy · 2 clone · 1 download · 1 not placed · primary: astro-docs · editable: astro-docs`, only the non-zero parts) and then lists each segment with up and down buttons, exclude or remove. A row with a directory has two lines of controls: **Place** (the material select with Symlink / Copy / Clone / Download / Don't place, its options, and for a repository **Primary** and **Editable**; Editable is hidden when the repository cannot be edited) and **In LLM_CONTEXT.md** (the mode select over the list that fits the placement, plain text when there is only one choice, and the mode's options). Without a directory a row has the single **Include as** select. The row head shows the destination, the reference type, an owner badge (`mine` / `not mine`) and, for a remote skill, `git` or `archive`. Markdown editors and warnings complete the pane. The list is the same pure expansion the server runs, so reordering and mode changes show immediately.
* **Preview**. Renders the real document through the server about 400 ms after the last edit, with Copy, Download .md and the manifest table (with a Material column when a directory is set). With a directory it shows the relative document of the dry run (`paths=relative`, default) and a button that opens the Run view; `paths=absolute` shows the single-document render and the "Write to path" box.
* **Run**. Run settings on the left (run overrides, the directory, context file, primary, and for every included item a **Place** select plus, for a repository that can be edited, an **Editable** checkbox, with a reset per item), the plan on the right (status line, blocking problems, warnings, the step list, the **Run** button); after starting, the job progress replaces the plan (status, **Cancel**, one row per step with its action, duration and collapsible output, and at the end the directory with "Open in IDE", "Copy path" and "Back to plan").

The ad hoc discovery list has the same tabs as the Forge, **All** first (`dataset=all`: entries of every linkable dataset together, with a dataset badge on each row). Unsaved edits of the working recipe are kept as a draft in `localStorage` (14 days) and restored after a reload with a "Restored unsaved changes" banner and a Discard button (a recipe changed on disk meanwhile is restored with a warning); there is no native leave prompt, and switching recipes still asks first. A never-saved `new` recipe is not persisted. The markdown block and preamble editors complete `ctxman:` links like every markdown editor (see [Editing](/concepts/editing.md)).

URL parameters: `recipe` (a recipe name, or `new` for the create dialog), `view` (`compose`, `preview` or `run`), `dataset` (the ad hoc discovery tab, a linkable dataset or `all`), `q` (its text filter), `job` (the job being watched; only kept with `view=run`) and `paths` (`absolute`; relative is the default and omitted). Save with the button or Cmd/Ctrl+S; unsaved edits are guarded when you switch recipes or leave. A recipe's own page at `/recipe/<name>` shows its composition read-only (including the output directory, the primary marker, an Editable column and an Editable row in the Output panel) with an "Open in Inflate" button.

## Code map

All under `src/lib/inflate/` unless noted:

| File | Kind | Role |
| --- | --- | --- |
| `catalog.ts` | pure | Targets, layouts, item kinds, modes (also per placement: `modesForPlacement`), options, materials (`materialLabel`), `isEditEligible`, destinations, output constants, segment keys |
| `recipe.ts` | pure | Parse, normalize and serialize a recipe (override key order `key, mode, options, material, materialOptions, edit, exclude`); `sameRecipe` for the dirty check; `applyRunOverrides` and `parseRunRequest` |
| `expand.ts` | pure | `expandRecipe` (material, then placement-aware mode, primary, Editable) and `applyOrder` |
| `material-plan.ts` | pure | `planMaterialization` (the ordered steps), `.gitignore` and stub texts, path mapping, and every type that crosses the API |
| `markdown.ts` | node (no fs) | Heading shifting, link rewriting, path links (`pathLink`), fences, quoting |
| `render.ts` | node (no fs) | Plan plus gathered content to document and manifest, also the working-directory document |
| `pipeline.ts` | node (no fs) | Loads inputs, gathers file content, runs expand and render |
| `fs-sources.ts` | node | The filesystem implementation of the pipeline's sources |
| `write.ts` | node | Output path checks and the atomic write of the single document |
| `output-dir.ts` | node | `checkOutputDir`, `inspectOutputDir`, `blockingFor`, the manifest reader and writer |
| `material-exec.ts` | node | `executeSteps`: every step with its re-checks, idempotency and cleanup |
| `dir-plan.ts` | node | `planInflateDir` (the dry run) and `executeDirPlan` (it also imports `proc.ts`) |
| `jobs.ts` | server | The in-memory job store, one run at a time |
| `src/lib/proc.ts` | server | `spawnCapture`: child processes with a timeout, abort and line callback |

Recipes are read and written through `src/lib/recipe-io.ts` (the mirror of `context-io.ts`); like every dataset they are read from the disk per request, see [Runtime modes](/concepts/runtime-modes.md). The island may import only the pure files. Related: [Architecture](/concepts/architecture.md), [Datasets](/concepts/datasets.md) and [Compliance checks](/concepts/compliance-checks.md) for the recipe warnings.
