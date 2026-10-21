// Per-item controls of a composition row (INFLATE_SPEC §4.2/§4.4, §9.3, INFLATE_V3_PLAN §8). With a working
// directory a row has two lines: PLACE (the material Select, its options, Primary and Editable of a repository)
// and "In <context file>" (the placement-aware mode Select and the mode's options). A recipe without a
// directory has the "Include as" mode Select only. The controls are generated from the catalog: the mode's
// `options` pick the OPTION_DEFS entries, whose `control` picks the widget; the material's `options` pick
// MATERIAL_OPTION_DEFS the same way. Values shown are the RESOLVED options of the segment; edits go through
// `setMode` / `setOption` / `setMaterial` / `setMaterialOption` / `setEdit`, which drop overrides that equal
// what the plan would pick anyway.
import { useStore } from '@nanostores/react';
import {
  CLONE_DIR_MESSAGE,
  DEFAULT_CONTEXT_FILE,
  GIT_REF_MESSAGE,
  MATERIAL_OPTION_DEFS,
  OPTION_DEFS,
  cloneDepthLabel,
  isMaterialFor,
  isModeFor,
  isPlaceableKind,
  isPrimaryEligible,
  isSafeGitRef,
  isSafeRelativeDir,
  materialDef,
  materialDescription,
  materialLabel,
  materialsFor,
  modeDef,
  modesFor,
  modesForPlacement,
} from '../../lib/inflate/catalog.ts';
import type {
  MaterialOptionDef,
  MaterialOptionId,
  OptionDef,
  OptionId,
} from '../../lib/inflate/catalog.ts';
import type { ItemSegment } from '../../lib/inflate/expand.ts';
import {
  $outputDir,
  $working,
  setEdit,
  setMaterial,
  setMaterialOption,
  setMode,
  setOption,
  setPrimary,
} from '../../stores/inflate.ts';
import { useDraftField } from '../edit/useDraftField.ts';
import { Checkbox, ListBoxItem, Select, TextField } from '../kit/index.ts';

type TextDef = Extract<OptionDef, { control: 'text' }>;

function TextOption({ seg, def }: { seg: ItemSegment; def: TextDef }) {
  const resolved = seg.options[def.id] ?? def.default;
  // The text being typed; kept while the field has focus so a `{name}` template is not rewritten under
  // the cursor. Only valid values are committed to the recipe.
  const f = useDraftField(resolved, (v) => setOption(seg.key, def.id, v), isSafeRelativeDir);
  return (
    <span className="cx-seg__opt">
      <span className="cx-seg__optlabel" title={def.help}>
        {def.label}
      </span>
      <TextField
        size="sm"
        mono
        aria-label={`${def.label} for ${seg.title}`}
        value={f.shown}
        onChange={f.onChange}
        onBlur={f.onBlur}
        isInvalid={f.invalid}
        errorMessage={CLONE_DIR_MESSAGE}
        inputTestId={`inflate-opt-${def.id}`}
        className="cx-seg__textopt"
      />
    </span>
  );
}

function OptionControl({ seg, id }: { seg: ItemSegment; id: OptionId }) {
  const def = OPTION_DEFS[id];
  const value = seg.options[id];
  switch (def.control) {
    case 'checkbox':
      return (
        <span className="cx-seg__opt" title={def.help}>
          <Checkbox
            isSelected={value === true}
            onChange={(on) => setOption(seg.key, id, on)}
            data-testid={`inflate-opt-${id}`}
          >
            {def.label}
          </Checkbox>
        </span>
      );
    case 'select-number': {
      const current = typeof value === 'number' ? value : def.default;
      const choices = def.choices.includes(current)
        ? def.choices
        : [...def.choices, current].sort((a, b) => a - b);
      return (
        <span className="cx-seg__opt">
          <span className="cx-seg__optlabel" title={def.help}>
            {def.label}
          </span>
          <Select
            size="sm"
            aria-label={`${def.label} for ${seg.title}`}
            value={current}
            onChange={(key) => {
              if (key !== null) setOption(seg.key, id, Number(key));
            }}
            triggerTestId={`inflate-opt-${id}`}
          >
            {choices.map((n) => (
              <ListBoxItem key={n} id={n} textValue={String(n)}>
                {n}
              </ListBoxItem>
            ))}
          </Select>
        </span>
      );
    }
    case 'text':
      return <TextOption seg={seg} def={def} />;
  }
}

type MaterialTextDef = Extract<MaterialOptionDef, { control: 'text' }>;

/** Placeholder of an empty Branch / New branch field: what empty means for this material. */
function refPlaceholder(seg: ItemSegment, id: MaterialTextDef['id']): string {
  if (id === 'newBranch') return 'none';
  return seg.material === 'worktree' ? 'repository HEAD' : 'default branch';
}

function BranchOption({ seg, def }: { seg: ItemSegment; def: MaterialTextDef }) {
  const resolved = seg.materialOptions[def.id] ?? def.default;
  // Like TextOption: only valid refs are committed, the draft stays while the field has focus.
  const f = useDraftField(resolved, (v) => setMaterialOption(seg.key, def.id, v), isSafeGitRef);
  return (
    <span className="cx-seg__opt">
      <span className="cx-seg__optlabel" title={def.help}>
        {def.label}
      </span>
      <TextField
        size="sm"
        mono
        aria-label={`${def.label} for ${seg.title}`}
        value={f.shown}
        onChange={f.onChange}
        onBlur={f.onBlur}
        placeholder={refPlaceholder(seg, def.id)}
        isInvalid={f.invalid}
        errorMessage={GIT_REF_MESSAGE}
        inputTestId={`inflate-mopt-${def.id}`}
        className="cx-seg__branchopt"
      />
    </span>
  );
}

function MaterialOption({ seg, id }: { seg: ItemSegment; id: MaterialOptionId }) {
  const def = MATERIAL_OPTION_DEFS[id];
  switch (def.control) {
    case 'select-number': {
      const value = seg.materialOptions.cloneDepth;
      const current = typeof value === 'number' ? value : def.default;
      const known: readonly number[] = def.choices;
      const choices = known.includes(current) ? known : [...known, current];
      return (
        <span className="cx-seg__opt">
          <span className="cx-seg__optlabel" title={def.help}>
            {def.label}
          </span>
          <Select
            size="sm"
            aria-label={`${def.label} for ${seg.title}`}
            value={current}
            onChange={(key) => {
              if (key !== null) setMaterialOption(seg.key, id, Number(key));
            }}
            triggerTestId="inflate-mopt-cloneDepth"
          >
            {choices.map((n) => (
              <ListBoxItem key={n} id={n} textValue={cloneDepthLabel(n)}>
                {cloneDepthLabel(n)}
              </ListBoxItem>
            ))}
          </Select>
        </span>
      );
    }
    case 'text':
      // A branch only means something for a git URI; an archive download has none.
      if (seg.meta?.uriKind === 'archive') return null;
      return <BranchOption key={def.id} seg={seg} def={def} />;
    case 'checkbox':
      // Sparse checkout needs a subpath to check out: offered only when the reference has one (the entry
      // summary carries it; the planner ignores the flag without one).
      if (seg.meta?.subpath === undefined) return null;
      return (
        <span className="cx-seg__opt" title={def.help}>
          <Checkbox
            isSelected={seg.materialOptions.subpathOnly === true}
            onChange={(on) => setMaterialOption(seg.key, id, on)}
            data-testid="inflate-mopt-subpathOnly"
          >
            {def.label}
          </Checkbox>
        </span>
      );
  }
}

function PrimaryCheckbox({ seg }: { seg: ItemSegment }) {
  const working = useStore($working);
  return (
    <span
      className="cx-seg__opt"
      title="The repository the session works on; the document leads with it."
    >
      <Checkbox
        isSelected={working?.output?.primary === seg.key}
        onChange={(on) => setPrimary(on ? seg.key : null)}
        data-testid="inflate-segment-primary"
        aria-label={`Primary repository: ${seg.title}`}
      >
        Primary
      </Checkbox>
    </span>
  );
}

function EditableCheckbox({ seg }: { seg: ItemSegment }) {
  // null = this repository or folder cannot be edited (a copy, a remote repository that is not cloned)
  if (seg.edit === null) return null;
  const noun = seg.kind === 'local-folder' ? 'folder' : 'repository';
  return (
    <span
      className="cx-seg__opt"
      title={`The session may change files in this ${noun}; otherwise it is reference material.`}
    >
      <Checkbox
        isSelected={seg.edit}
        onChange={(on) => setEdit(seg.key, on)}
        data-testid="inflate-segment-edit"
        aria-label={`Editable ${noun}: ${seg.title}`}
      >
        Editable
      </Checkbox>
    </span>
  );
}

/**
 * Line 1 (working directory): what a run places for this item, its options, Primary and Editable. None for a
 * kind with nothing to place (a snippet).
 */
function PlaceLine({ seg }: { seg: ItemSegment }) {
  const { kind, material } = seg;
  if (kind === null || material === null || !isPlaceableKind(kind)) return null;
  const uriKind = seg.meta?.uriKind;
  const options = materialDef(kind, material)?.options ?? [];
  return (
    <div className="cx-seg__opts" data-testid="inflate-segment-materials">
      <span
        className="cx-seg__optlabel"
        title="How a run gets this item into the working directory"
      >
        Place
      </span>
      <Select
        size="sm"
        aria-label={`Material for ${seg.title}`}
        value={material}
        onChange={(key) => {
          const next = String(key);
          if (key !== null && isMaterialFor(kind, next)) setMaterial(seg.key, next);
        }}
        triggerTestId="inflate-segment-material"
        className="cx-seg__material"
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
      {options.map((id) => (
        <MaterialOption key={id} seg={seg} id={id} />
      ))}
      {isPrimaryEligible(kind, material) && <PrimaryCheckbox seg={seg} />}
      <EditableCheckbox seg={seg} />
    </div>
  );
}

/**
 * The mode line. With a directory: "In <context file>" over the placement-aware list (static text when there is
 * only one entry). Document only: "Include as" over the family list.
 */
function ModeLine({ seg, contextFile }: { seg: ItemSegment; contextFile: string | null }) {
  const { kind, mode } = seg;
  if (kind === null || mode === null) return null;
  const list = contextFile === null ? modesFor(kind) : modesForPlacement(kind, seg.placed);
  const current = list.find((m) => m.id === mode);
  const options = (current ?? modeDef(kind, mode))?.options ?? [];
  return (
    <div className="cx-seg__opts" data-testid="inflate-segment-modes">
      <span
        className="cx-seg__optlabel"
        title={contextFile === null ? 'How the document presents this item' : undefined}
      >
        {contextFile === null ? 'Include as' : `In ${contextFile}`}
      </span>
      {list.length === 1 ? (
        <span
          className="cx-seg__static"
          title={current?.description}
          data-testid="inflate-segment-mode"
        >
          {current?.label ?? mode}
        </span>
      ) : (
        <Select
          size="sm"
          aria-label={`Mode for ${seg.title}`}
          value={mode}
          onChange={(key) => {
            const next = String(key);
            if (key !== null && isModeFor(kind, next)) setMode(seg.key, next);
          }}
          triggerTestId="inflate-segment-mode"
          className="cx-seg__mode"
        >
          {list.map((m) => (
            <ListBoxItem key={m.id} id={m.id} textValue={m.label} description={m.description}>
              {m.label}
            </ListBoxItem>
          ))}
        </Select>
      )}
      {options.map((id) => (
        <OptionControl key={id} seg={seg} id={id} />
      ))}
    </div>
  );
}

export function OptionControls({ seg }: { seg: ItemSegment }) {
  const dir = useStore($outputDir);
  const working = useStore($working);
  if (seg.kind === null || seg.mode === null) return null;
  if (dir === null) return <ModeLine seg={seg} contextFile={null} />;
  return (
    <>
      <PlaceLine seg={seg} />
      <ModeLine seg={seg} contextFile={working?.output?.contextFile ?? DEFAULT_CONTEXT_FILE} />
    </>
  );
}
