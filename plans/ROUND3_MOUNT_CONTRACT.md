# Round 3 EntryTools mount contract (from the W8b hand-back, 2026-10-18) — for W8a

```astro
import EntryTools from '../../../ui/entry/EntryTools.tsx'   // default export
<EntryTools client:only="react" dataset={ds} slug={slug} title={title} kind={'okf'|'skill'|'reference'}
            relationKeys={[...]} childEntries={[...]} related={[...]} linkedContexts={[...]} />
```
- Mount ONCE per detail page in the header actions area. No fallback; it renders only
  `<p role="status" class="cx-entry__status" data-testid="entry-status">` (always present, hidden when empty) — use it as the
  "island mounted" signal in e2e. Every SSR action button starts `disabled`; the island enables them on mount.
- Props: `dataset` (LinkableDatasetId), `slug`, `title`, `kind`; arrays default to []:
  `relationKeys: 'ds/slug'[]` (frontmatter links; excluded from pickers), `childEntries: {key,title}[]` (project pages; NOTE the
  prop is `childEntries`, never `children` — Astro overwrites `children`), `related: {key,title}[]` (related + depends-on
  targets), `linkedContexts: string[]` (from backRefs).
- The island does its own `GET /api/entry` when the Details dialog opens (no fileModified prop needed).
- SSR buttons use `data-entry-action` (clicks delegated on `document`):
  `frontmatter` (okf+skill) · `add-relation` · `add-child` (project) · `remove-relation` / `remove-child` (need `data-key`, optional
  `data-rel`, `data-title`; fall back to the enclosing `[data-key]` row) · `add-to-context` · `build-context` (project) ·
  `new-concept` (optional `data-path="concepts/x.md"` for the bundle-404 "Create this file" case).
- Lock rule: while `$docEdit` is true, all `[data-entry-action]` and `select[data-state-select]` are disabled with
  `title="Leave the editor first"`. The SSR state select must use `data-state-select` and be handled by shell.ts
  (PATCH /api/entry/:ds/:slug {state}); disable it during the request.
- Test ids: `entry-status`; Details `fm-*` (fm-dialog, fm-title, fm-description, fm-tags, fm-add-tag, fm-state, fm-stale-after,
  fm-stale-plus30/plus90/clear, fm-okf-status, fm-save/cancel/status, fm-reload, fm-conflict, fm-error); relation picker
  `relation-picker` (+ EntryPicker suffixes -search/-row/-pick/-cancel/-ds-<id>), `relation-rel`, `relation-remove-dialog`
  (buttons by role/name); `add-to-context-*` (dialog, select, name, notes, submit, cancel, error); `build-context-*` (dialog,
  item[data-key], target, name, submit, cancel, error, count); `new-concept-*` (dialog, name, path, title, type, description,
  submit, cancel, error).
- Read path (W3): `getEntryDetail` adds `relations: { linksTo, linkedFrom, children?, parents }` rows
  `{key, dataset, slug, rel, label, title, state, missing, source, files}` and `fileModified`; `EntrySummary.invalid?: Issue[]`,
  `relations?: EntryLink[]`; `getRelationGraph()` + `childrenOf(graph, 'project/<slug>')` for the `?project=` list filter
  (`EntryFilter.keys`); on project pages hide `rel === 'child'` rows from "Links to" (they are in Children).
- W9: list-page "New" buttons for okf/skill datasets now go to `/new/<ds>` (NewEntryForm); project pages can link
  `/new/task?parent=<slug>` etc.
- W1: `.cx-prose a.cx-link--broken` styling (dashed danger underline + cursor: help) lives in prose.css (W8a).
