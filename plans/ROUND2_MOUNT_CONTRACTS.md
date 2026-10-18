# Round 2 mount contracts for U8 (from the U2/U5/U6/U7 hand-backs, 2026-10-18)

## CSS (global.css, after tools.css; all files are `@layer cx-app`)
@import '../ui/edit/edit.css';
@import '../ui/markdown/markdown.css';
@import '../ui/forms/forms.css';

## okf + skill detail pages and the sub-doc page (DocEditor)
```astro
import DocEditor from '../../../ui/markdown/DocEditor.tsx'   // default export
import { parseEditUrl } from '../../../lib/url-state.ts'
const edit = parseEditUrl(Astro.url.searchParams).edit
<section class="cx-detail__main cx-doc" aria-label="Content">
  <DocEditor client:only="react" dataset={ds} slug={slug} path={path} previewId="cx-doc-preview" initialEdit={edit}>
    <div slot="fallback" class="cx-doctools cx-doctools--fallback" aria-hidden="true"></div>
  </DocEditor>
  <article id="cx-doc-preview" class="cx-prose cx-doc__preview" data-testid="detail-content" hidden={edit}><Fragment set:html={html} /></article>
</section>
```
- dataset: OkfDatasetId | 'skill'; path: 'main.md' | 'SKILL.md' | doc.relPath (sub-doc).
- The island renders a sticky `.cx-doctools` Toolbar, warnings list, `.cx-doc__editor` (edit mode) and dialogs; it only toggles `hidden`/`data-stale` on `#cx-doc-preview`.
- `.cx-doc__preview[data-stale]` dimming lives in markdown.css; `max-width` and the `.cx-detail--doc` two-column layout (details LEFT ~320px, content RIGHT; collapse < 1100px) live in app.css (UI_SPEC §G.1).
- "Open in IDE" = SSR button handled in shell.ts (UI_SPEC §G), POST /api/ide/open `{dataset, slug, path?}`; GET /api/ide/open reports availability (disable button + title when unavailable); 501 → inline message.

## Context detail page
- Replace `ContextLinks.astro` (deleted) with `ContextLinkList.astro` props `{ slug, links }` (same `ResolvedLink[]`).
- Mount ONCE on the page: `<MarkdownTargets client:only="react" targets={contextNoteTargets(slug, detail.links)} />`
  (`ui/markdown/MarkdownTargets.tsx` default export; `contextNoteTargets` from `ui/markdown/targets.ts`).
- app.css: add `.cx-rowlink*` (UI_SPEC §G.5) and `.cx-ctxlinks__list` / `.cx-ctxlink*` (§G.2) rules; delete `.cx-ctxgroup*` and `.cx-recipe__table*`.

## Recipe detail page
- `RecipeComposition.astro` same props; Preamble panel always rendered ("None" when empty).
- Mount ONCE: `<MarkdownTargets client:only="react" targets={recipeTargets(slug, detail.blocks)} />`.
- app.css: `.cx-recipe__block` is now a wrapper div around `<details class="cx-recipe__details">` — retarget the old `.cx-recipe__block > summary` rules (incl. `[open]`, `::before`) to `.cx-recipe__details`; add
  `.cx-recipe__block { position: relative; border-bottom: 1px solid var(--border) }`, `.cx-recipe__block:last-child { border-bottom: 0 }`, `.cx-recipe__blockedit { position: absolute; top: 2px; right: 0 }`.
- Overrides/defaults tables use `ck-table ck-table--compact` twin classes.
- `MdEditButton.astro` exists (pencil twin built from ICONS); may be swapped for `<Icon name="pencil" size={14}/>` once `Icon.astro` exists.

## yaml datasets (reference, context, recipe) edit mode (DataForm)
In `src/pages/[dataset]/[slug]/index.astro`, when `parseEditUrl(Astro.url.searchParams).edit` && `isYamlDatasetId(def.id)` (from `src/lib/forms/fields.ts`), render instead of the SSR main column:
```astro
import DataForm from '../../../ui/forms/DataForm.tsx';
<DataForm client:only="react" dataset={def.id} mode="edit" slug={slug}>
  <div slot="fallback" class="cx-island-fallback">Loading editor…</div>
</DataForm>
```
- Detail "Edit" button → `/<ds>/<slug>?edit=1`. List-page "New" buttons: `/new/reference`, `/new/context`, `/new/recipe` (others keep `/tools?add=<ds>`; recipe list "New recipe" currently points at `/inflate?recipe=new` — switch to `/new/recipe` per UI_SPEC and update recipe.spec).
- Test ids `dform*` as listed in the U7 hand-back; confirm buttons: `getByTestId('dform-delete-dialog').getByRole('button', { name: 'Delete' })`.

## Clickable rows (UI_SPEC §G.5 / item 7)
EntryTable.astro rows: stretched-link technique (`position: relative` row, main link `::after` covers the row, inline buttons z-index above); shell.ts not needed for this.

## Tests to update/add (U8): tests/e2e/{detail,doc-edit,md-popup,recipe,smoke}.spec.ts + forms.spec edit cases; forge.spec "context page lists the links in the order the Forge saved" must pass once the context page is rewired.
