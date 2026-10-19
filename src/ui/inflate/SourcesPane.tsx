// Left pane of Inflate (INFLATE_SPEC §9.3, INFLATE_V3_PLAN §8): description, output directory, preamble, contexts
// to include, defaults per item kind (only the kinds the recipe uses), ad hoc items and the "+ Markdown block" button.
import { useStore } from '@nanostores/react';
import {
  DEFAULT_CONTEXT_FILE,
  ITEM_KINDS,
  ITEM_KIND_LABELS,
  defaultMaterialFor,
  defaultModeFor,
  isMaterialFor,
  isPlaceableKind,
  materialDescription,
  materialLabel,
  materialsFor,
  modeDef,
  modesFor,
  modesForPlacement,
} from '../../lib/inflate/catalog.ts';
import type { ItemKind, MaterialId, ModeId } from '../../lib/inflate/catalog.ts';
import type { Segment } from '../../lib/inflate/expand.ts';
import type { RecipeData } from '../../datasets/schemas.ts';
import { $entries } from '../../stores/entries.ts';
import {
  $outputDir,
  $plan,
  $working,
  insertMarkdownAfter,
  saveIfDirty,
  setDefaultMaterial,
  setDefaultMode,
  setDescription,
  setPreamble,
  toggleContext,
} from '../../stores/inflate.ts';
import {
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  CodeEditor,
  Disclosure,
  EmptyState,
  Icon,
  ListBoxItem,
  Loading,
  Select,
  TextField,
} from '../kit/index.ts';
import { AdhocDiscover } from './AdhocDiscover.tsx';
import { lineCount, plural } from './format.ts';
import { OutputPanel } from './OutputPanel.tsx';

const DEFAULT_ITEM = '__default__';

function ContextsSection({ selected }: { selected: readonly string[] }) {
  const entries = useStore($entries, { keys: ['context'] });
  const state = entries.context;
  const contexts = [...(state?.entries ?? [])].sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
  const known = new Set(contexts.map((c) => c.slug));
  const missing = state?.status === 'ready' ? selected.filter((s) => !known.has(s)) : [];
  return (
    <section className="cx-sources__section" aria-labelledby="inflate-contexts-h">
      <h3 id="inflate-contexts-h" className="cx-label">
        Contexts <span className="cx-subtle">({selected.length})</span>
      </h3>
      {contexts.length === 0 && missing.length === 0 ? (
        state?.status === 'ready' ? (
          <EmptyState compact title="No contexts yet">
            Build one in the <a href="/forge">Forge</a>.
          </EmptyState>
        ) : (
          <Loading label="Loading…" />
        )
      ) : (
        <ul className="cx-ctxlist" data-testid="inflate-contexts">
          {contexts.map((c) => (
            <li key={c.slug} className="cx-ctxlist__item" title={c.description}>
              <Checkbox
                isSelected={selected.includes(c.slug)}
                onChange={(on) => toggleContext(c.slug, on)}
                data-testid="inflate-context"
                data-slug={c.slug}
              >
                <span className="cx-ctxlist__name">{c.name}</span>
                <span className="cx-subtle cx-ctxlist__links">{c.linkCount ?? 0} links</span>
              </Checkbox>
              <ButtonLink
                variant="ghost"
                size="sm"
                iconOnly
                className="cx-ctxlist__open"
                href={`/context/${c.slug}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open context ${c.slug} in a new tab`}
              >
                <Icon name="external" size={13} />
              </ButtonLink>
            </li>
          ))}
          {missing.map((slug) => (
            <li key={slug} className="cx-ctxlist__item">
              <Checkbox
                isSelected
                onChange={(on) => toggleContext(slug, on)}
                data-testid="inflate-context"
                data-slug={slug}
              >
                <span className="cx-ctxlist__name">{slug}</span>
                <Badge tone="danger" title="This context no longer exists">
                  missing
                </Badge>
              </Checkbox>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The item kinds the recipe has (included or excluded items) plus any kind with a stored default. */
function kindsInUse(working: RecipeData, segments: readonly Segment[]): ItemKind[] {
  const present = new Set<ItemKind>();
  for (const seg of segments) {
    if (seg.type !== 'item' || seg.kind === null) continue;
    if (seg.status === 'included' || seg.status === 'excluded') present.add(seg.kind);
  }
  return ITEM_KINDS.filter((k) => present.has(k) || working.defaults[k] !== undefined);
}

/**
 * One kind: "Place" (the default material; only with a working directory) and "In <context file>" / "Include as"
 * (the default mode, over the list that fits the placement of that default material).
 */
function DefaultKindRow({
  kind,
  working,
  hasDir,
}: {
  kind: ItemKind;
  working: RecipeData;
  hasDir: boolean;
}) {
  const { target } = working;
  const label = ITEM_KIND_LABELS[kind];
  const mode: ModeId | undefined = working.defaults[kind]?.mode;
  const material: MaterialId | undefined = working.defaults[kind]?.material;
  const builtInMaterial = defaultMaterialFor(kind, target);
  const effectiveMaterial =
    material !== undefined && isMaterialFor(kind, material) ? material : builtInMaterial;
  // Same verdict as the expander: a directory is set and the material places something.
  const placed = hasDir && effectiveMaterial !== 'none';
  const modes = hasDir ? modesForPlacement(kind, placed) : modesFor(kind);
  const builtIn = defaultModeFor(kind, target, placed);
  const builtInLabel =
    modes.find((m) => m.id === builtIn)?.label ?? modeDef(kind, builtIn)?.label ?? builtIn;
  const builtInMaterialLabel = materialLabel(kind, builtInMaterial);
  // A stored mode the placement does not offer (a skill `install` while the skill is symlinked) is not applied
  // (the expander falls back to the default); it stays in the recipe and comes back with the material.
  const shownMode = mode !== undefined && modes.some((m) => m.id === mode) ? mode : DEFAULT_ITEM;
  return (
    <div className="cx-defrow" data-dir={hasDir ? 'true' : undefined}>
      <span className="cx-defrow__label">{label}</span>
      {hasDir && !isPlaceableKind(kind) && (
        <span className="cx-seg__static" title={materialDescription(kind, builtInMaterial)}>
          {builtInMaterialLabel}
        </span>
      )}
      {hasDir && isPlaceableKind(kind) && (
        <Select
          aria-label={`Default material for ${label} items`}
          size="sm"
          value={material ?? DEFAULT_ITEM}
          onChange={(key) => {
            if (key === null) return;
            const next = String(key);
            setDefaultMaterial(kind, next === DEFAULT_ITEM ? null : (next as MaterialId));
          }}
          triggerTestId={`inflate-default-material-${kind}`}
          pinnedKeys={[DEFAULT_ITEM]}
        >
          <ListBoxItem id={DEFAULT_ITEM} textValue={`Default (${builtInMaterialLabel})`}>
            Default ({builtInMaterialLabel})
          </ListBoxItem>
          {materialsFor(kind).map((m) => (
            <ListBoxItem
              key={m.id}
              id={m.id}
              textValue={materialLabel(kind, m.id)}
              description={materialDescription(kind, m.id)}
            >
              {materialLabel(kind, m.id)}
            </ListBoxItem>
          ))}
        </Select>
      )}
      {modes.length === 1 ? (
        <span
          className="cx-seg__static"
          title={modes[0]?.description}
          data-testid={`inflate-default-${kind}`}
        >
          {builtInLabel}
        </span>
      ) : (
        <Select
          aria-label={`Default mode for ${label} items`}
          size="sm"
          value={shownMode}
          onChange={(key) => {
            if (key === null) return;
            const next = String(key);
            setDefaultMode(kind, next === DEFAULT_ITEM ? null : (next as ModeId));
          }}
          triggerTestId={`inflate-default-${kind}`}
          pinnedKeys={[DEFAULT_ITEM]}
        >
          <ListBoxItem id={DEFAULT_ITEM} textValue={`Default (${builtInLabel})`}>
            Default ({builtInLabel})
          </ListBoxItem>
          {modes.map((m) => (
            <ListBoxItem key={m.id} id={m.id} textValue={m.label} description={m.description}>
              {m.label}
            </ListBoxItem>
          ))}
        </Select>
      )}
    </div>
  );
}

function DefaultsSection({ working }: { working: RecipeData }) {
  const plan = useStore($plan);
  const dir = useStore($outputDir);
  const hasDir = dir !== null;
  const kinds = kindsInUse(working, plan?.segments ?? []);
  const custom = ITEM_KINDS.filter(
    (k) => working.defaults[k]?.mode !== undefined || working.defaults[k]?.material !== undefined,
  ).length;
  return (
    <Disclosure
      title="Default modes"
      meta={custom === 0 ? 'built-in' : `${custom} custom`}
      triggerTestId="inflate-defaults-toggle"
    >
      {kinds.length === 0 ? (
        <EmptyState compact title="No items yet">
          Defaults per item kind appear once the recipe has items.
        </EmptyState>
      ) : (
        <div className="cx-defmodes" data-testid="inflate-defaults">
          <div className="cx-defrow cx-defrow--head" data-dir={hasDir ? 'true' : undefined}>
            <span />
            {hasDir && <span className="cx-seg__optlabel">Place</span>}
            <span className="cx-seg__optlabel">
              {hasDir ? `In ${working.output?.contextFile ?? DEFAULT_CONTEXT_FILE}` : 'Include as'}
            </span>
          </div>
          {kinds.map((kind) => (
            <DefaultKindRow key={kind} kind={kind} working={working} hasDir={hasDir} />
          ))}
        </div>
      )}
    </Disclosure>
  );
}

export function SourcesPane() {
  const working = useStore($working);
  if (working === null) return null;
  const preamble = working.preamble ?? '';
  return (
    <section
      className="cx-forge__pane cx-forge__pane--discover"
      aria-labelledby="inflate-sources-h"
      data-testid="inflate-sources"
    >
      <header className="cx-forge__pane-header">
        <h2 id="inflate-sources-h" className="cx-forge__pane-title ck-label">
          Sources
        </h2>
      </header>
      <div className="cx-forge__pane-body cx-sources">
        <TextField
          label="Description"
          size="sm"
          value={working.description}
          onChange={setDescription}
          isRequired
          isInvalid={working.description.trim() === ''}
          errorMessage="Required"
          inputTestId="inflate-description"
        />
        <OutputPanel working={working} />
        <Disclosure
          title="Instructions (preamble)"
          meta={preamble.trim() === '' ? 'none' : plural(lineCount(preamble), 'line')}
          triggerTestId="inflate-preamble-toggle"
        >
          {({ isExpanded }) =>
            isExpanded && (
              <CodeEditor
                language="markdown"
                compact
                value={preamble}
                onChange={setPreamble}
                height={{ mode: 'auto', minLines: 8, maxLines: 24 }}
                ariaLabel="Preamble instructions"
                placeholder="Markdown instructions placed at the top of the document…"
                onSave={saveIfDirty}
                testId="inflate-preamble"
              />
            )
          }
        </Disclosure>
        <ContextsSection selected={working.contexts} />
        <DefaultsSection working={working} />
        <AdhocDiscover />
        <div className="cx-sources__section">
          <Button
            size="sm"
            onPress={() => insertMarkdownAfter(null)}
            data-testid="inflate-add-markdown"
          >
            + Markdown block
          </Button>
        </div>
      </div>
    </section>
  );
}
