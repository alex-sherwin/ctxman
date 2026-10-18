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
import { formatRelative } from '../../lib/time.ts';
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
import {
  Button,
  ButtonLink,
  Chip,
  ChipGroup,
  ConfirmDialog,
  Kbd,
  ListBoxItem,
  Select,
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
    <ChipGroup
      label="Layout"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[layout]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === 'grouped' || next === 'flat') setLayout(next);
      }}
      data-testid="inflate-layout-toggle"
    >
      {INFLATE_LAYOUTS.map((l) => (
        <Chip key={l} id={l} data-testid={`inflate-layout-${l}`}>
          {LAYOUT_LABELS[l]}
        </Chip>
      ))}
    </ChipGroup>
  );
}

function ViewToggle() {
  const { view } = useStore($inflateUrl);
  return (
    <ChipGroup
      label="View"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === 'compose' || next === 'preview' || next === 'run') selectView(next);
      }}
      data-testid="inflate-view-toggle"
    >
      <Chip id="compose" data-testid="inflate-view-compose">
        Compose
      </Chip>
      <Chip id="preview" data-testid="inflate-view-preview">
        Preview
      </Chip>
      <Chip id="run" data-testid="inflate-view-run">
        Run
      </Chip>
    </ChipGroup>
  );
}

/** The only component that ticks every second (relative "Saved 5 seconds ago"). */
function StatusLine() {
  const dirty = useStore($dirty);
  const status = useStore($saveStatus);
  const now = useStore($now);

  let kind: 'idle' | 'dirty' | 'error' | 'saved' = 'idle';
  let text = 'No changes';
  if (status.kind === 'saving') {
    text = 'Saving…';
  } else if (status.kind === 'error') {
    kind = 'error';
    const detail = (status.issues ?? []).map((i) =>
      i.path ? `${i.path}: ${i.message}` : i.message,
    );
    text = `Save failed: ${[status.message ?? 'unknown error', ...detail].join('; ')}`;
  } else if (dirty) {
    kind = 'dirty';
    text = 'Unsaved changes';
  } else if (status.kind === 'saved' && status.at !== undefined) {
    kind = 'saved';
    text = `Saved ${formatRelative(new Date(status.at).toISOString(), now)}`;
  } else if (status.kind === 'deleted') {
    text = status.message ?? 'Deleted';
  }
  return (
    <span className="cx-forge__status" role="status" data-kind={kind} data-testid="inflate-status">
      {text}
    </span>
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
