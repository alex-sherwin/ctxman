// Left pane of the Run view (plans/INFLATE_V2_SPEC.md §11.4, INFLATE_V3_PLAN §8): what THIS run does differently
// from the recipe (directory, context file, primary repository, Place and Editable per item). Nothing here edits the recipe until
// "Save to recipe"; the dry run on the right always plans the recipe plus these overrides.
import { useStore } from '@nanostores/react';
import {
  CONTEXT_FILE_MESSAGE,
  CONTEXT_FILE_PATTERN,
  DEFAULT_CONTEXT_FILE,
  defaultDirFor,
  isMaterialFor,
  isPlaceableKind,
  isPortableAbsoluteDir,
  isPrimaryEligible,
  materialDescription,
  materialLabel,
  materialsFor,
} from '../../lib/inflate/catalog.ts';
import type { ItemSegment } from '../../lib/inflate/expand.ts';
import { $dirty, $working } from '../../stores/inflate.ts';
import {
  $destByKey,
  $dirPlan,
  $effective,
  $effectivePlan,
  $runOverrideCount,
  $runOverrides,
  clearRunOverrides,
  resetRunItem,
  saveRunOverrides,
  setRunAllowNonEmpty,
  setRunContextFile,
  setRunDir,
  setRunEdit,
  setRunMaterial,
  setRunPrimary,
} from '../../stores/inflate-run.ts';
import { useDraftField } from '../edit/useDraftField.ts';
import {
  Badge,
  Button,
  Checkbox,
  DatasetBadge,
  EmptyState,
  Icon,
  ListBoxItem,
  Notice,
  Select,
  TextField,
} from '../kit/index.ts';
import { plural } from './format.ts';

const NONE_ITEM = '__none__';

function OverrideBadge() {
  return (
    <Badge tone="warn" title="Applies to this run only until you save it to the recipe">
      override
    </Badge>
  );
}

function DirField({ recipeDir, name }: { recipeDir: string; name: string }) {
  const overrides = useStore($runOverrides);
  const f = useDraftField(overrides.dir ?? recipeDir, setRunDir);
  return (
    <div className="cx-run__field">
      <TextField
        label="Directory"
        size="sm"
        mono
        value={f.shown}
        onChange={f.onChange}
        onBlur={f.onBlur}
        placeholder={defaultDirFor(name)}
        isInvalid={f.shown.trim() !== '' && !isPortableAbsoluteDir(f.shown)}
        errorMessage="must be absolute or start with ~/"
        inputTestId="inflate-run-dir"
      />
      {overrides.dir !== undefined && <OverrideBadge />}
    </div>
  );
}

function ContextFileField({ recipeFile }: { recipeFile: string }) {
  const overrides = useStore($runOverrides);
  const f = useDraftField(overrides.contextFile ?? recipeFile, setRunContextFile, (v) =>
    CONTEXT_FILE_PATTERN.test(v),
  );
  return (
    <div className="cx-run__field">
      <TextField
        label="Context file"
        size="sm"
        mono
        value={f.shown}
        onChange={f.onChange}
        onBlur={f.onBlur}
        isInvalid={f.invalid}
        errorMessage={CONTEXT_FILE_MESSAGE}
        inputTestId="inflate-run-contextfile"
      />
      {overrides.contextFile !== undefined && <OverrideBadge />}
    </div>
  );
}

/** Included items with a known kind: the ones a run places something for. */
/** The included items a run can place (a snippet places nothing: its markdown is in the context file). */
function runItems(segments: readonly ItemSegment[]): ItemSegment[] {
  return segments.filter(
    (s) => s.status === 'included' && s.kind !== null && isPlaceableKind(s.kind),
  );
}

function PrimarySelect({ items, primary }: { items: ItemSegment[]; primary: string | null }) {
  const overrides = useStore($runOverrides);
  const eligible = items.filter((s) => isPrimaryEligible(s.kind, s.material));
  const known = primary === null || eligible.some((s) => s.key === primary);
  return (
    <div className="cx-run__field">
      <Select
        label="Primary repository"
        size="sm"
        value={primary ?? NONE_ITEM}
        onChange={(key) => {
          if (key === null) return;
          setRunPrimary(String(key) === NONE_ITEM ? null : String(key));
        }}
        triggerTestId="inflate-run-primary"
        pinnedKeys={[NONE_ITEM]}
      >
        <ListBoxItem id={NONE_ITEM} textValue="None">
          None
        </ListBoxItem>
        {eligible.map((s) => (
          <ListBoxItem key={s.key} id={s.key} textValue={s.title} description={s.key}>
            {s.title}
          </ListBoxItem>
        ))}
        {!known && primary !== null && (
          <ListBoxItem key={primary} id={primary} textValue={primary} description="not placeable">
            {primary}
          </ListBoxItem>
        )}
      </Select>
      {overrides.primary !== undefined && <OverrideBadge />}
    </div>
  );
}

function RunItem({ seg }: { seg: ItemSegment }) {
  const overrides = useStore($runOverrides);
  const dest = useStore($destByKey).get(seg.key);
  const kind = seg.kind;
  if (kind === null || seg.material === null) return null;
  const uriKind = seg.meta?.uriKind;
  // Material, material options and Editable are all reset together.
  const overridden = overrides.items[seg.key] !== undefined;
  return (
    <li
      className="cx-run__item"
      data-testid="inflate-run-item"
      data-key={seg.key}
      data-overridden={overridden ? 'true' : 'false'}
    >
      <div className="cx-run__itemhead">
        <DatasetBadge dataset={seg.dataset} />
        <span className="ck-entryline__title cx-truncate">{seg.title}</span>
        {dest !== undefined && <code className="cx-seg__dest cx-truncate">{dest}</code>}
      </div>
      <div className="cx-run__itemctl">
        <span className="cx-seg__optlabel">Place</span>
        <Select
          size="sm"
          aria-label={`Material for ${seg.title}`}
          value={seg.material}
          onChange={(key) => {
            const next = String(key);
            if (key !== null && isMaterialFor(kind, next)) setRunMaterial(seg.key, next);
          }}
          triggerTestId="inflate-run-item-material"
          className="cx-run__itemmaterial"
        >
          {materialsFor(kind).map((m) => {
            const label = materialLabel(kind, m.id, uriKind);
            return (
              <ListBoxItem
                key={m.id}
                id={m.id}
                textValue={label}
                description={materialDescription(kind, m.id, uriKind)}
              >
                {label}
              </ListBoxItem>
            );
          })}
        </Select>
        {seg.edit !== null && (
          <Checkbox
            isSelected={seg.edit}
            onChange={(on) => setRunEdit(seg.key, on)}
            data-testid="inflate-run-item-edit"
            aria-label={`Editable ${seg.kind === 'local-folder' ? 'folder' : 'repository'}: ${seg.title}`}
          >
            Editable
          </Checkbox>
        )}
        {overridden && (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={`Reset ${seg.title} to the recipe`}
            onPress={() => resetRunItem(seg.key)}
            data-testid="inflate-run-item-reset"
          >
            <Icon name="close" size={12} />
          </Button>
        )}
      </div>
    </li>
  );
}

export function RunSettings() {
  const working = useStore($working);
  const effective = useStore($effective);
  const effectivePlan = useStore($effectivePlan);
  const count = useStore($runOverrideCount);
  const dirty = useStore($dirty);
  const dirPlan = useStore($dirPlan);
  const overrides = useStore($runOverrides);
  if (working === null || effective === null) return null;
  const items = runItems(
    (effectivePlan?.segments ?? []).filter((s): s is ItemSegment => s.type === 'item'),
  );
  const askAllow =
    effective.output?.allowNonEmpty === true ||
    (dirPlan.result?.blocking ?? []).some(
      (b) => b.code === 'dir-not-empty' || b.code === 'manifest-invalid',
    );

  return (
    <section
      className="cx-forge__pane cx-forge__pane--discover"
      aria-labelledby="inflate-run-settings-h"
      data-testid="inflate-run-settings"
    >
      <header className="cx-forge__pane-header">
        <h2 id="inflate-run-settings-h" className="cx-forge__pane-title ck-label">
          Run settings
        </h2>
      </header>
      <div className="cx-forge__pane-body cx-sources">
        {count > 0 && (
          <Notice
            tone="warn"
            layout="row"
            testId="inflate-run-overrides"
            actions={
              <>
                <Button
                  size="sm"
                  onPress={saveRunOverrides}
                  data-testid="inflate-run-overrides-save"
                >
                  Save to recipe
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={clearRunOverrides}
                  data-testid="inflate-run-overrides-clear"
                >
                  Clear
                </Button>
              </>
            }
          >
            {plural(count, 'run override')} (not saved)
          </Notice>
        )}
        {dirty && (
          <Notice tone="info" testId="inflate-run-dirty">
            Unsaved recipe edits are included in this run.
          </Notice>
        )}
        <DirField recipeDir={working.output?.dir ?? ''} name={working.name} />
        <ContextFileField recipeFile={working.output?.contextFile ?? DEFAULT_CONTEXT_FILE} />
        {askAllow && (
          <div className="cx-run__field">
            <Checkbox
              isSelected={effective.output?.allowNonEmpty === true}
              onChange={setRunAllowNonEmpty}
              data-testid="inflate-run-allownonempty"
            >
              Allow a non-empty directory
            </Checkbox>
            {overrides.allowNonEmpty !== undefined && <OverrideBadge />}
          </div>
        )}
        <PrimarySelect items={items} primary={effective.output?.primary ?? null} />
        <section className="cx-sources__section" aria-labelledby="inflate-run-items-h">
          <h3 id="inflate-run-items-h" className="cx-label">
            Items <span className="cx-subtle">({items.length})</span>
          </h3>
          {items.length === 0 ? (
            <EmptyState compact title="Nothing included yet" />
          ) : (
            <ul className="cx-run__items" data-testid="inflate-run-items">
              {items.map((seg) => (
                <RunItem key={seg.key} seg={seg} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
