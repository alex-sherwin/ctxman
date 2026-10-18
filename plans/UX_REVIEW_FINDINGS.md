# UX review findings (2026-10-18)

Reviewer: a subagent acting as the owner, driving the real app (`astro dev` on :4360, headless Chromium, 1440×900) against a
scratch copy of `data/`, following `plans/UX_REVIEW_BRIEF.md`. It walked all seven journeys with a "Lantern mod"
(a Stardew Valley SMAPI mod) scenario: kb `stardew-modding`, feature `lantern-lighting`, tasks `lantern-sprite-art` and
`lantern-light-radius`, idea `lantern-colors`, project `lantern-mod`, references `lantern-mod-repo` (remote git repo,
served by a local fixture) and `smapi-skill` (remote tarball), context `lantern-mod-dev`, recipe `lantern-mod-session`,
inflated into a scratch directory.

Screenshots live in `SHOTS = /private/tmp/claude-501/-Users-asherwin-repos-ctxman/bec9b9b2-9912-474c-ae01-7820622a329e/scratchpad/ux-shots/`.
Findings below cite `SHOTS/<file>.png`.

## What works well

- **Creating entries**: the Tools add form checks the name inline ("Use lowercase letters…", "Required") and opens the new entry page about 0.9 s after Create.
- **Doc editor**: Preview|Edit toggle, Cmd+S, a clear "Saved · 1 warning" status with a schema finding for an invalid `state`, a "Changed on disk" conflict dialog (Keep editing / Load disk version / Overwrite), and "Restored unsaved changes" after a dev reload.
- **Reference form** (`/new/reference`, `?edit=1`): typed fields that switch with `type`, a clear git/archive URI error, a YAML tab kept in sync with "✓ Valid", a tag input, and a derived git/archive badge in lists.
- **Forge**: add from Discover ("✓ Added"), per-link Monaco notes, ↑/↓ buttons plus working drag and drop, a YAML view with live validation, Save ⌘S, a beforeunload guard, and "Create nope" for an unknown `?context=`.
- **Context page**: linked items show their dataset badge and live state chip. The pencil note popup saves and reloads.
- **Inflate**: the Compose → Preview → Run flow is solid:
  - The Plan lists every step before anything runs.
  - The Run shows per-step status. A 404 skill download failed alone without blocking the other 16 steps.
  - A re-run is idempotent ("12 unchanged") and keeps a user's `NOTES.md` and uncommitted repo edits.
  - Open in IDE launched the (fake) IDE.
- **LLM_CONTEXT.md**: it has a working-directory map, a "Primary repository" section ("Work in `repos/lantern-mod-repo`"), context notes as quoted callouts, a "stale since" marker, links between included items rewritten to working-dir-relative paths, and failed installs reported under Skills.
- **URL state**: list filters, sort, search modal (`?search=1&sq=`), Forge tab and query, and Inflate view all survive back, forward and deep links. Esc closes search and cleans the URL.
- **Search**: Cmd+K from any page, results grouped by dataset with counts and dataset chips, arrow keys plus Enter, and reference URIs and recipe preambles are searchable.

## Findings

Severity: P0 blocks a journey (as the brief defines it: linking and state must be possible in the UI without raw
markdown/frontmatter/YAML), P1 major friction, P2 minor, P3 polish. J1–J7 = journey numbers from the review task.

### P0

**UX-01 · P0 · Okf detail pages (`/feature/<slug>` etc.), list rows**
- What happened: lifecycle `state` is a static badge. The only way to change it is Edit → Monaco → retype `state: pending` in raw frontmatter. A typo (`state: done`) saves anyway (`SHOTS/14-state-invalid.png`).
- Expected: a state picker on the entry page and in list rows.
- Fix: make the Details-panel state badge a Select of the registry states. Back it with a small `PATCH /api/doc/<ds>/<slug>/frontmatter` that rewrites only that key. Add the same control as a row menu in lists. (J2)

**UX-02 · P0 · Doc editor (any okf page `?edit=1`)**
- What happened: cross-entry links can only be typed by hand as `[text](ctxman:<dataset>/<slug>)`. Typing `ctxman:` offers nothing, and Ctrl+Space shows "No suggestions" (`SHOTS/08b-editor-ctrl-space.png`). There is no toolbar, picker or help text. To link the project to its feature, tasks, idea and kb I had to know the syntax and every slug (`SHOTS/20b-project-links-view.png`).
- Expected: a "Link entry…" action that searches entries and inserts the link.
- Fix: register a Monaco completion provider on `ctxman:` (and after `](`) fed by `/api/search-index.json`. Add a toolbar button / Cmd+Shift+K that opens the existing search modal in "pick" mode and inserts `[Title](ctxman:ds/slug)`. (J1, J3)

**UX-03 · P0 · Project / feature / task detail pages**
- What happened: entries have no relationships beyond prose links.
  - A project page cannot list its children.
  - `feature/lantern-lighting` does not show that `project/lantern-mod` links to it. Only "Linked from contexts" exists.
  - Lists cannot filter "tasks of project X".
  - The dashboard cannot show project progress.
- Expected: a "part of / contains" relation managed in the UI.
- Fix:
  - Build a backlink index from the `ctxman:` links that check-links already parses. Show "Links to" and "Linked from entries" panels, with dataset badges and state chips, on every detail page.
  - On project pages add a "Children" panel with "+ Add existing…" (picker that appends a link to a `## Scope` list) and "+ New task/feature/idea" (scaffold, then append the link). (J3)

### P1

**UX-04 · P1 · Okf detail Files panel, bundle doc 404**
- What happened: you cannot add a second concept file to a bundle from the UI. The Files panel has no "New file", and the docs say the doc API "only edits an existing .md file". A link to a not-yet-written `./concepts/smapi.md` leads to a generic 404 (`SHOTS/10-broken-intra-link.png`).
- Expected: "+ New concept".
- Fix: add "+ New concept" to the Files panel (name + `type`), which scaffolds `concepts/<name>.md` with frontmatter and adds it to `index.md`. Make the bundle-doc 404 offer "Create concepts/smapi.md". (J1)

**UX-05 · P1 · Doc editor save status, markdown preview**
- What happened: saving markdown with a broken intra-bundle link and a misspelled `ctxman:idea/lantern-colours` reports a plain "Saved" (`SHOTS/09-after-save.png`). Only Tools → check-links reports `ERROR links/broken` (`SHOTS/11-check-links.png`). Broken and missing links render exactly like valid ones (`SHOTS/20b-project-links-view.png`).
- Expected: link findings in the save status and visibly broken links.
- Fix: run the links checker on the saved file and merge its findings into the "Saved · N warnings" status. Render unresolved `ctxman:` and bundle links with a "missing" style and a tooltip. (J1, J3)

**UX-06 · P1 · Create flow (Tools add form, list "New …" buttons)**
- What happened:
  - The create form has only name, title and description. There is no state, no tags and no parent project, so every new entry needs a second, raw-frontmatter edit.
  - For `reference` it silently writes `uri: https://github.com/TODO/<name>.git` and drops the Title.
  - The list "New KB entry" button sends you to the Tools page, mixed with the compliance checks (`SHOTS/04-new-kb-click.png`).
- Expected: a proper per-dataset create form.
- Fix: serve `/new/<ds>` for every dataset (reuse DataForm) with a state select, a tag input and an optional "Part of project" picker. Route `reference` to the existing reference form. Point list and dashboard "New" buttons there. (J1, J2, J4)

**UX-07 · P1 · Okf entry metadata**
- What happened: tags, title, description, `stale_after`, status and verified can only be changed by editing YAML frontmatter in Monaco (`SHOTS/07-kb-edit.png`). References, contexts and recipes have typed forms with a tag input, so okf entries are the odd ones out.
- Expected: form fields for frontmatter.
- Fix: add a Form | Source toggle to the doc editor for `main.md`. Form shows typed frontmatter fields (tags input, state select, date picker for `stale_after`) and Monaco for the body. Source stays raw. (J1, J2)

**UX-08 · P1 · Entry page and list after an invalid save**
- What happened: after `state: done` was saved, the content layer rejected the file, but the page and the list kept showing the old data (PENDING, no tags, `SHOTS/15-feature-list-after-invalid.png`). Nothing on the page says the file on disk is invalid. The error is only in the server log.
- Expected: a visible "this entry's file is invalid" state.
- Fix: track content-layer load failures per file. Show a persistent error banner with the zod message on the entry page and an error badge on its list row and the dashboard. (J2, J7)

**UX-09 · P1 · Forge, Inflate, doc editor during dev reloads**
- What happened: any change under `data/` (an IDE save, or creating an entry in another tab) triggers the dev full reload.
  - With unsaved Forge or Inflate work, a native "Leave site?" prompt appears.
  - If you confirm, the work is gone: the Forge went back from 4 to 3 links and Inflate from 13 to 12 segments, both "No changes" (`SHOTS/68-forge-after-external-reload.png`, `SHOTS/69-inflate-after-external-reload.png`).
  - The doc editor restores its draft but also pops the native prompt (`SHOTS/67-reload-during-edit.png`).
- Expected: compositions survive reloads silently.
- Fix: mirror the Forge and Inflate working documents to sessionStorage per slug, as DocEditor does, and restore them with a banner. Skip the beforeunload prompt when the draft is mirrored and the unload is a Vite reload. (J5, J6, J7)

**UX-10 · P1 · Entry pages → contexts; Forge/Inflate Discover**
- What happened:
  - From an entry page, "Find in Forge" opens the Forge with no context selected (`SHOTS/72-find-in-forge.png`), so you still pick a context and click Add.
  - Discover searches one dataset tab at a time. Collecting the Lantern items took 7 tab switches with the same filter.
  - Nothing adds "this project plus everything it links to".
- Expected: add to a context in one step from anywhere.
- Fix:
  - Add an "Add to context ▾" menu (context list plus an optional note) on every detail page and search result.
  - Add an "All" tab to Discover in both the Forge and Inflate.
  - Add "Add with linked entries" on project rows, using the UX-03 backlink index. (J5)

### P2

**UX-11 · P2 · Generated brief, Inflate default modes**
- What happened: tasks, features, projects and ideas default to "Summary", which is only the one-line description. The brief told the agent "Implement the light radius task first", yet it contained only "Implement light radius config per lantern type." The project's Scope list of children is also dropped (`LLM_CONTEXT.md` lines 52–97).
- Expected: the work the agent is asked to do is inlined.
- Fix: default work items to "Inline main.md" when a recipe has an output directory, or add a per-recipe "Focus items" set that is always inlined. Show a one-line explanation of each mode next to the select. (J6)

**UX-12 · P2 · Generated brief, markdown blocks**
- What happened: a block with `## Definition of done` inserted after the feature is emitted at H2 inside "## Context: lantern-mod-dev". That ends the context section, so the later `### Lantern light radius` etc. read as children of "Definition of done".
- Expected: blocks nest at the current level.
- Fix: run `shiftHeadings` on markdown blocks to the level of their surrounding group, or warn when a block contains H1/H2 inside a group. (J6)

**UX-13 · P2 · Generated brief, broken links**
- What happened: unresolved links pass through with "0 warnings":
  - `[colored lanterns](ctxman:idea/lantern-colours)` stays a raw `ctxman:` URI.
  - `[SMAPI notes](./concepts/smapi.md)` from `kb/stardew-modding` stays relative to the wrong root (it is not rewritten to `kb/stardew-modding/...`).
- Expected: warnings in the Plan and manifest.
- Fix: add a manifest/plan warning per unresolved link and render the link as plain text with "(missing)". (J6)

**UX-14 · P2 · Inflate Compose, primary repository**
- What happened: the Output panel says "Primary: none" with no control. The Primary checkbox only appears after you switch that reference's Material to Clone (`SHOTS/54-inflate-ref-material-clone.png`). The Run view has a Primary select, but Compose does not.
- Expected: pick the primary in the Output panel.
- Fix: put the Run view's "Primary repository" select in the Compose Output panel, and switch the chosen reference's material to Clone automatically. (J6)

**UX-15 · P2 · Inflate Default modes table**
- What happened: two unlabeled select columns ("Default (Inline main.md)" | "Default (Symlink)") with no indication that one is document mode and the other is working-dir material (`SHOTS/53-inflate-default-modes.png`). Segment rows offer Summary/Pointer/Describe/Install without explanations.
- Expected: labels and help.
- Fix: add column headers "In document" / "In directory", description lines inside every option (as the reference mode listbox already has), and a "?" popover on "Default modes". (J6)

**UX-16 · P2 · Recipe page, dashboard**
- What happened: re-inflating takes recipe page → Open in Inflate → Run tab → Run. The recipe page shows no last run, status or output-directory state (`SHOTS/77-recipe-detail-lantern.png`).
- Expected: Run from where the recipe is shown.
- Fix: add "Preview" and "Run" buttons plus a last-run summary (time, ok/failed counts, Open in IDE) to the recipe page and the dashboard recipe rows. (J6)

**UX-17 · P2 · Creation routes**
- What happened: entry points are inconsistent.
  - `/new/reference|context|recipe` exist, but `/new/kb` and `/new/task` are 404 (`SHOTS/64-err-_new_kb.png`).
  - Dashboard "New" for contexts goes to the Forge, while the Contexts list "New context" goes to a DataForm. Recipes are the same.
  - A context can be created four ways: Tools, `/new/context`, Forge, list.
- Expected: one obvious path per dataset.
- Fix: `/new/<ds>` for all datasets (see UX-06). Dashboard and list buttons point to the same target; for context and recipe that should be the Forge and Inflate dialogs. (J7)

**UX-18 · P2 · Context and recipe detail pages**
- What happened: three overlapping editors.
  - "Edit" opens a DataForm that can only change description and tags and says "8 links — edit in Forge" (`SHOTS/42-context-dataform.png`).
  - "Open in Forge" is a second editor.
  - The per-note pencil is a third.
  - Recipes have the same split (Edit vs Open in Inflate).
- Expected: one editor.
- Fix: make "Edit" open the Forge or Inflate, and move description and tags editing there (the Forge already has both fields). Keep the pencil popups. (J5, J7)

**UX-19 · P2 · Invalid context YAML on disk**
- What happened: `/context/okf-authoring` shows a generic 404 "There is nothing at …". The list and the dashboard silently omit it ("2 of 2" with 3 files). Only the Forge explains the parse error ("Couldn't load this context … line 3"), and it offers no way to fix it (`SHOTS/70-badyaml-_forge_context_okf_authoring.png`).
- Expected: an error state with a repair path.
- Fix: list invalid files with an error badge, and on the detail page show the parse error plus a raw YAML editor with Save. (J7)

**UX-20 · P2 · Context delete**
- What happened: deleting `lantern-mod-dev`, which recipe `lantern-mod-session` uses, shows only "Linked entries are not affected". There is no dependent-recipe warning and no "Used by recipes" panel on the context page.
- Expected: dependency awareness.
- Fix: list dependent recipes in the delete dialog and in a "Used by recipes" panel on context pages. (J5, J7)

**UX-21 · P2 · Forge Discover and Inflate "Add items" tab strips**
- What happened: at 1440 px the dataset tabs overflow and the last tab is cut off ("REFEREN…", "SKIL…") with no scroll affordance (`SHOTS/29-forge-initial.png`, `SHOTS/47-inflate-recipe-created.png`).
- Expected: all tabs visible.
- Fix: let the tabs wrap, or drop the count badges below a breakpoint, or use a dataset Select when the pane is narrow. (J5, J6)

**UX-22 · P2 · Global search**
- What happened: each okf entry returns three hits: the entry, `index.md` ("§ Lantern mod") and `log.md` ("Update log … Created Lantern mod"). "lantern" returned 29 results, including unrelated fuzzy kb hits such as "Provenance and lifecycle" (`SHOTS/18-search-lantern.png`).
- Expected: one hit per entry plus real concept matches.
- Fix: exclude `index.md` and `log.md` from the index (or fold them under the entry) and tighten the fuse threshold, or require token prefix matches for short queries. (J2, J7)

**UX-23 · P2 · Stale and freshness**
- What happened: there is no stale filter chip on lists, no "Mark verified" / "Review again by …" action, and `stale_after`, `verified` and `status` can only be set in frontmatter (`SHOTS/78-stale-kb.png`).
- Expected: manage freshness from the UI.
- Fix: add a `stale` chip to list filters and, on stale or any kb page, "Mark verified" and "Snooze until <date>" buttons that write the frontmatter keys. (J1)

**UX-24 · P2 · Okf/skill entry lifecycle**
- What happened: okf and skill entries have no Delete or Rename in the UI. Contexts, recipes and references do. A typo'd name means going to the file system.
- Fix: add Delete (with a warning from the UX-03 backlink index) and Rename (moves the folder and rewrites `ctxman:` links and context/recipe references) to okf and skill detail pages. (J1, J7)

**UX-25 · P2 · Markdown `ctxman:` link rendering**
- What happened: links between entries render as plain text links, so hand-written status prose goes stale unnoticed. The seed project page says `forge-reorder-focus` is "(in progress)" while the bug is FIXED (`SHOTS/19-project-ctxman-v1.png`).
- Expected: live status next to linked entries.
- Fix: render `ctxman:` links in previews as inline chips (dataset color plus live state, as the context page does) so prose never has to repeat state. (J3)

**UX-26 · P2 · Tag inputs (reference form, Forge)**
- What happened: the placeholder "add tag, Enter" reads as comma-separated. Typing `stardew,skill,` shows "Lowercase letters, digits and hyphens", and the pending text is silently dropped on Create, so the reference was saved with no tags.
- Fix: split on comma, space and Enter, and commit pending text on blur and on Save. (J4)

**UX-27 · P2 · Dashboard**
- What happened: it shows counts and recent modifications but no "in progress" work, no per-project rollup, and no create action for okf datasets (`SHOTS/01-dashboard.png`). After a clone every row says "upd just now".
- Expected: a starting point for the owner's work.
- Fix: add an "In progress" panel grouped by project (using the UX-03 index), a "+ New ▾" menu, and recipe Run buttons (UX-16). (J7)

### P3

**UX-28 · P3 · List filter**
- What happened: the text filter applies only on Enter, while chips apply instantly. The Forge filter is live (`SHOTS/17b-task-filter-q.png`).
- Fix: debounce live filtering (and keep `q` in the URL with replaceState). (J2)

**UX-29 · P3 · Internal identifiers in the UI**
- What happened:
  - The recipe page "Custom order" lists `ctx:lantern-mod-dev`, `md:b1` and `sec:extra` (`SHOTS/77-recipe-detail-lantern.png`).
  - Markdown blocks are named "b1".
  - Run skips read "skipped: dl:reference/smapi-skill did not succeed".
  - The manifest shows "Markdown b1 md:b1".
- Fix: show human labels ("Context intro: lantern-mod-dev", "Block: Definition of done"), let users name blocks (default to the block's first heading), and say "skipped because the download failed". (J6)

**UX-30 · P3 · Detail page layout consistency**
- What happened: okf and skill pages put Details on the left, while reference, context and recipe pages put it on the right (`SHOTS/25-ref-detail.png`). Description and type are repeated in the body and in Details.
- Fix: use one layout (Details left) and drop the duplicate fields. (J4)

**UX-31 · P3 · Open in IDE**
- What happened: Open in IDE is missing on reference, context and recipe pages. The status text differs: "Opened in VS Code" on detail pages, "Opened in the IDE" in Inflate. Inflate opens only the folder, not `LLM_CONTEXT.md`.
- Fix: add the button to the yaml dataset pages (data dir plus file), use one label, and pass `LLM_CONTEXT.md` as the file argument. (J6, J7)

**UX-32 · P3 · Paths**
- What happened: Details "FILE" shows `data/kb/...` even when `CTXMAN_DATA_DIR` points elsewhere. Doc URLs with the `.md` shown in the Files panel 404 (`/kb/ctxman/doc/concepts/editing.md`, `SHOTS/64-err-_kb_ctxman_doc_concepts_editing_md.png`).
- Fix: show the path relative to the real data dir (absolute on hover) and redirect `…/doc/<path>.md` to the extensionless route. (J1)

**UX-33 · P3 · Inflate Run log and plan wording**
- What happened: git clone progress fills 20 lines ("Counting objects 14%…"), and the re-run Plan says "replace" for symlinks that the run then reports as "unchanged" (`SHOTS/61-inflate-rerun-plan.png`, `SHOTS/60-inflate-run-result.png`).
- Fix: run git with `--quiet` (or collapse progress lines), and label the plan step "check" or "keep if same". (J6)

**UX-34 · P3 · Generated brief nits**
- What happened:
  - Empty template headings ("#### Overview", "#### Details", "#### Milestones") are inlined.
  - The failed skill appears twice: under "Skills: Not installed" and again with manual install commands that use `.ctxman/tmp`, while the run used `.ctxman-tmp`.
  - The context note for the primary repo ("Clone this; the mod source lives under src/. Build with dotnet.") appears only under the item, not in the "Primary repository" section, which is where an agent looks for what the repo is for.
- Fix: drop empty headings, keep failed installs in one place with one tmp path, and copy the primary repo's context notes into the Primary section. (J6)

**UX-35 · P3 · Conflict dialog**
- What happened: Keep editing / Load disk version / Overwrite, but no way to see what changed on disk (`SHOTS/66-conflict-dialog.png`).
- Fix: add "Compare" to open a Monaco diff of the disk version against the draft. (J7)

**UX-36 · P3 · 404 page**
- What happened: only "Back to the dashboard" (`SHOTS/10-broken-intra-link.png`).
- Fix: for `/<ds>/<slug>`, offer search results for the slug and "Create <ds> '<slug>'". (J7)

**UX-37 · P3 · Inflate segment noise**
- What happened: the remote-skill archive segment shows a "Branch" field, which is meaningless for a tarball, and every segment shows a byte size ("406 B") that is noise for references (`SHOTS/56-inflate-md-block.png`).
- Fix: hide Branch for archives, and show sizes only for inlined modes or behind a toggle. (J6)

**UX-38 · P3 · Terminology load**
- What happened: Inflate packs many terms with little explanation: "Inflate recipes", "segments", "sources", "material", "ad hoc items", "overrides", "Describe/Install/Summary/Pointer", "Grouped/Flat". The dashboard never explains how a context relates to a recipe.
- Fix: add a short intro line under each Inflate pane header and a glossary popover. On the dashboard, label the Contexts and Recipes panels "Contexts (what to read)" and "Recipes (how to hand it to an agent)". (J6, J7)

**UX-39 · P3 · log.md and Tools title field**
- What happened: there is no UI to append a dated `## YYYY-MM-DD` log entry. The Tools form offers "Title (Optional human title)" for reference, context and recipe, which have no title field, so the value is silently dropped.
- Fix: add an "Add log entry" button on the Files panel `log.md` row, and hide Title for datasets without one. (J1, J4)

**UX-40 · P3 · Robustness: a shared `.astro` content store** (environment-triggered)
- What happened: while I reviewed, an e2e run started from the same checkout (`astro dev --port 4322` with another `CTXMAN_DATA_DIR`). It rewrote `.astro/data-store.json`, and my :4360 server silently switched to that data. My new `project/lantern-mod` and `kb/stardew-modding` started returning 404.
- Expected: one instance's data never leaks into another.
- Fix: key the content-layer cache to the data dir (a separate `cacheDir`/`.astro` per `CTXMAN_DATA_DIR`), or have the server detect a store whose data dir differs and resync. Document the caveat. (J7)

## Top 10 to fix first

1. **UX-02** Link picker and `ctxman:` autocomplete in the doc editor (the core "link data in the UI" ask).
2. **UX-03** Backlink index, "Links to / Linked from" panels and a project "Children" panel with add buttons.
3. **UX-01** State select on detail pages and list rows.
4. **UX-07** + **UX-06** Frontmatter form (tags, title, description, `stale_after`) and per-dataset `/new/<ds>` create forms with state, tags and parent.
5. **UX-09** Persist Forge/Inflate drafts across dev reloads, with no native prompt.
6. **UX-05** Link findings on save and visibly broken links in previews.
7. **UX-10** "Add to context" from any entry, an "All" tab in Discover, "add with linked entries".
8. **UX-04** "+ New concept" in the Files panel and "Create this file" on bundle 404s.
9. **UX-08** Visible invalid-file state on the entry page, list and dashboard.
10. **UX-11** + **UX-12** + **UX-13** Brief quality: inline the focus work items, heading-shift markdown blocks, warn on unresolved links.

## Gaps between the use case and the product today

- **Linking between datasets is the main gap.** The brief says "anywhere data can be linked between datasets, there must be a way to do that IN THE UI".
  - Today the only UI-managed links are context links (Forge) and recipe composition (Inflate).
  - Every other relation lives in hand-typed markdown with no picker, autocomplete or validation at save, and the product never reads those relations back: no backlinks, no project children, no "tasks of project X". Project → feature/task/idea/kb is exactly this case.
  - UX-02 and UX-03 together close it.
- **Define → link → context → inflate.** The last two steps are good: the Forge plus Inflate produce a usable working directory and `LLM_CONTEXT.md` with a primary repo, clones, symlinks and notes. The first two steps force raw editing:
  - state, tags, `stale_after` and new concept files all need frontmatter or the file system;
  - links need memorised `ctxman:` syntax;
  - nothing connects a project to a context, so each item must be collected by hand across dataset tabs (UX-10). A "Build context from project" action on project pages, which needs UX-03, would join steps 2 and 3.
- **Feedback loop.** Errors appear late (invalid frontmatter and broken links surface only in Tools → checks or the server log). Compositions can vanish on an unrelated reload. Both erode trust in the browser as the place to work, which pushes the owner back to the IDE.
- **Briefs for agents.** The structure is right. The content defaults under-serve "go implement this task": summaries only, H2 blocks break the structure, and broken links pass silently. A per-recipe "focus" concept and link warnings would make the generated brief something you can trust without reading it first.

## Counts

P0: 3 · P1: 7 · P2: 17 · P3: 13 · total 40.
