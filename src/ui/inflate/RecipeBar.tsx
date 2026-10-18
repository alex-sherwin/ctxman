// Top bar of the Inflate island (INFLATE_SPEC §9.3): pick / create a recipe, target, layout, view, and
// the Save / Revert / Delete / status controls. State lives in src/stores/inflate.ts.
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import {
  INFLATE_LAYOUTS,
  INFLATE_TARGETS,
  LAYOUT_LABELS,
  TARGETS,
  isInflateTarget,
} from '../../lib/inflate/catalog.ts';
import type { InflateLayout } from '../../lib/inflate/catalog.ts';
import { $entries } from '../../stores/entries.ts';
import {
  $baseline,
  $dirty,
  $inflateUrl,
  $saveStatus,
  $working,
  deleteRecipe,
  revert,
  save,
  selectRecipe,
  setLayout,
  setTarget,
} from '../../stores/inflate.ts';
import { selectView } from '../../stores/inflate-run.ts';
import { $now } from '../../stores/now.ts';
import { modKeyLabel } from '../../stores/platform.ts';
import { saveStatusView } from '../edit/status.ts';
import {
  Button,
  ButtonLink,
  ChipToggle,
  ConfirmDialog,
  Kbd,
  ListBoxItem,
  Select,
  Status,
} from '../kit/index.ts';

const NEW_ITEM = '__new__';

function RecipeSelect() {
  const url = useStore($inflateUrl);
  const entries = useStore($entries, { keys: ['recipe'] });
  const recipes = [...(entries.recipe?.entries ?? [])].sort((a, b) =>
    a.slug.localeCompare(b.slug, 'en'),
  );
  const current = url.recipe === 'new' ? null : url.recipe;
  // The selected slug may not be in the list yet (loading) or at all (not found): keep it selectable.
  const known = current === null || recipes.some((r) => r.slug === current);
  return (
    <Select
      aria-label="Recipe"
      placeholder="Select a recipe…"
      value={current}
      onChange={(key) => selectRecipe(key === NEW_ITEM ? 'new' : key === null ? null : String(key))}
      size="sm"
      triggerTestId="inflate-recipe-select"
      pinnedKeys={[NEW_ITEM]}
      className="cx-inflate__recipeselect"
    >
      {recipes.map((r) => (
        <ListBoxItem key={r.slug} id={r.slug} textValue={r.slug} description={r.description}>
          {r.slug}
        </ListBoxItem>
      ))}
      {!known && current !== null && (
        <ListBoxItem key={current} id={current} textValue={current}>
          {current}
        </ListBoxItem>
      )}
      <ListBoxItem id={NEW_ITEM} textValue="New recipe…" data-testid="inflate-recipe-new">
        + New recipe…
      </ListBoxItem>
    </Select>
  );
}

function TargetSelect({ target }: { target: string }) {
  return (
    <Select
      aria-label="Target"
      value={target}
      onChange={(key) => {
        if (isInflateTarget(key)) setTarget(key);
      }}
      size="sm"
      triggerTestId="inflate-target"
      className="cx-inflate__targetselect"
    >
      {INFLATE_TARGETS.map((t) => (
        <ListBoxItem key={t} id={t} textValue={TARGETS[t].label}>
          {TARGETS[t].label}
        </ListBoxItem>
      ))}
    </Select>
  );
}

function LayoutToggle({ layout }: { layout: InflateLayout }) {
  return (
    <ChipToggle
      label="Layout"
      value={layout}
      onChange={setLayout}
      testId="inflate-layout-toggle"
      options={INFLATE_LAYOUTS.map((l) => ({
        id: l,
        label: LAYOUT_LABELS[l],
        testId: `inflate-layout-${l}`,
      }))}
    />
  );
}

function ViewToggle() {
  const { view } = useStore($inflateUrl);
  return (
    <ChipToggle
      label="View"
      value={view}
      onChange={selectView}
      testId="inflate-view-toggle"
      options={[
        { id: 'compose', label: 'Compose', testId: 'inflate-view-compose' },
        { id: 'preview', label: 'Preview', testId: 'inflate-view-preview' },
        { id: 'run', label: 'Run', testId: 'inflate-view-run' },
      ]}
    />
  );
}

/** The only component that ticks every second (relative "Saved 5 seconds ago"). */
function StatusLine() {
  const dirty = useStore($dirty);
  const status = useStore($saveStatus);
  const now = useStore($now);
  const view = saveStatusView(status, dirty, now);
  return (
    <Status kind={view.kind} testId="inflate-status" className="cx-forge__status">
      {view.text}
    </Status>
  );
}

function SaveControls({ name }: { name: string }) {
  const dirty = useStore($dirty);
  const status = useStore($saveStatus);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    setDeleting(true);
    await deleteRecipe();
    setDeleting(false);
    setConfirmOpen(false);
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onPress={() => void save()}
        isDisabled={!dirty}
        isPending={status.kind === 'saving'}
        data-testid="inflate-save"
      >
        Save <Kbd>{modKeyLabel}S</Kbd>
      </Button>
      <Button size="sm" onPress={revert} isDisabled={!dirty} data-testid="inflate-revert">
        Revert
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setConfirmOpen(true)}
        data-testid="inflate-delete"
      >
        Delete…
      </Button>
      <StatusLine />
      <ConfirmDialog
        isOpen={confirmOpen}
        title={`Delete recipe "${name}"?`}
        confirmLabel="Delete"
        tone="danger"
        isPending={deleting}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmOpen(false)}
        testId="inflate-delete-dialog"
      >
        This deletes data/recipe/{name}.yaml. Contexts and entries are not affected.
      </ConfirmDialog>
    </>
  );
}

export function RecipeBar() {
  const working = useStore($working);
  const baseline = useStore($baseline);
  return (
    <div className="cx-inflate__bar">
      <RecipeSelect />
      {working && (
        <>
          <TargetSelect target={working.target} />
          <LayoutToggle layout={working.layout} />
          <ViewToggle />
          <ButtonLink
            variant="ghost"
            size="sm"
            href={`/recipe/${working.name}`}
            data-testid="inflate-view-recipe"
          >
            View page ↗
          </ButtonLink>
        </>
      )}
      <span className="cx-inflate__spacer" />
      {working && baseline && <SaveControls name={working.name} />}
    </div>
  );
}
