# Round 2 brief (user requests, 2026-10-17) — read by both planners

## Non-negotiable architecture constraint (user decision)
Editing files in the IDE MUST keep auto-updating the running UI exactly as today: content collections keep their glob
loaders and watchers; `astro dev` keeps its full reload after a `data/` change. In-browser markdown editing is a
SECONDARY feature and must not change this architecture: it uses an explicit **Save** button (no autosave, no
debounce), and the dev full reload that follows a save is acceptable (content is already on disk). Design the editor
so a reload after Save is harmless (return to preview mode; the reloaded page shows the saved content; `?edit=1` is
NOT kept in the URL after save).

## Items (verbatim intent)
1. All changes follow good architecture and React component reuse.
2. Inflate recipe ad-hoc markdown blocks: collapsed by default, currently no disclosure arrow. Add an arrow that shows open/closed state. When closed show the beginning of the markdown, single line, text-overflow ellipsis. When expanded hide that preview and show the full Monaco editor as now.
3. All dropdowns are not user friendly: the chevron is far too small and does not change direction on open/close. Replace with a searchable, autocomplete-style, RAC-based select component (kit-wide, used everywhere a select appears in React islands; SSR list pages' native sort select gets the same visual treatment as far as HTML+CSS allows).
4. For inlined-markdown datasets (kb, rca, idea, task, bug, feature, project, skill) detail pages: details on the LEFT, markdown preview on the RIGHT; a toggle between markdown preview (default) and a Monaco editor with an explicit Save button (see constraint above; the user originally asked for 200 ms autosave and then changed this to explicit Save).
5. Any markdown content anywhere must be quickly editable in-browser with Monaco: a popup overlay for small markdown areas (e.g. context link notes, recipe preamble/blocks on detail pages), an in-place edit toggle for full-size rendered areas. Always explicit Save.
6. BUG (Forge): on the Discover pane the dataset tabs (kb, rca, …) show no counts until a tab is clicked (counts come from the per-dataset entries cache that is only fetched on tab select).
7. All table displays: when a row has a main clickable column, the whole row is clickable (inline buttons/inputs inside the row stop propagation).
8. All data-only datasets (reference, context, recipe): in-browser forms for managing their data (create, edit, delete) — not only the Forge/Inflate tools.
9. Tools page: creating a new entry navigates to it automatically.
10. Forge and Inflate ordered lists: drag-and-drop reordering with react-aria DnD, drag handle in the first (number) column; if these lists aren't RAC GridLists already, switch them to GridList.
11. Use proper react-aria components for list and table displays generally (keyboard nav, tab behavior).
12. Context detail page is too busy: show linked items in context order (no grouping by dataset); each row: type badge (kb/rca/…) BEFORE the slug/name/title on the same line; keep the colored left border matching the type color.
13. "Open in IDE" button on every markdown-backed item: launch the `code` CLI with the OKF bundle folder (or skill folder) as the workspace root, ideally also opening the specific file. Never open just the file (root would be wrong).
14. YAML datasets (reference, context, recipe): JSON Schema per dataset + redhat yaml-language-server magic comment (`# yaml-language-server: $schema=<relative path>`) as the first line of every YAML data file, with realtime feedback in the IDE. Implement by adding arktype (latest) with an arktype model per YAML dataset mirroring the zod schema (zod stays for Astro collections), a script that generates the JSON Schema files from the arktype models, and references to those files from the YAML files. In-browser Monaco YAML editors should get the same realtime schema feedback.

## Pre-agreed API / file surface (both planners design against these names; the backend planner may refine shapes but not names)
- `GET  /api/doc/<dataset>/<slug>/<...path>`  → `{ path, markdown, lastModified }` for a markdown file inside an okf bundle / skill dir (`path` bundle-relative, `.md` only, no traversal).
- `PUT  /api/doc/<dataset>/<slug>/<...path>`  body `{ markdown, ifUnmodifiedSince? }` → `{ path, bytes, lastModified, warnings }`; 409 on mtime conflict; file must exist (no create in this round).
- `POST /api/ide/open` body `{ dataset, slug, path? }` → spawns the `code` CLI with the entry dir (+ file); `{ ok, command }`; 404 unknown entry, 501 if `code` not found.
- `GET|PUT|DELETE /api/reference/:slug`, `POST /api/reference` — same conventions as `/api/context`.
- Generated JSON Schemas: `schemas/<dataset>.schema.json` (committed) for reference, context, recipe; generator `scripts/gen-schemas.ts`; `check:schemas` verifies they are up to date; YAML first line `# yaml-language-server: $schema=../../schemas/<dataset>.schema.json`; served to the browser by `GET /api/schemas/[dataset]`.
- Content collections, loaders, `render(entry)`, `entries.ts` and the dev reload behavior are UNCHANGED.
