// Left pane of Inflate (INFLATE_SPEC §9.3): description, preamble, contexts to include, default modes per
// item kind, ad hoc items and the "+ Markdown block" button.
import { useStore } from '@nanostores/react';
import {
  ITEM_KINDS,
  ITEM_KIND_LABELS,
  defaultMaterialFor,
  defaultModeFor,
  materialDef,
  materialsFor,
  modeDef,
  modesFor,
} from '../../lib/inflate/catalog.ts';
import type { InflateTarget, ItemKind, MaterialId, ModeId } from '../../lib/inflate/catalog.ts';
import { $entries } from '../../stores/entries.ts';
import {
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
  Checkbox,
  CodeEditor,
  Disclosure,
  ListBoxItem,
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
        <p className="cx-sources__hint">
          {state?.status === 'ready' ? (
            <>
              No contexts yet. Build one in the <a href="/forge">Forge</a>.
            </>
          ) : (
            'Loading…'
          )}
        </p>
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
              <a
                className="ck-iconbtn cx-ctxlist__open"
                href={`/context/${c.slug}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open context ${c.slug} in a new tab`}
              >
                ↗
              </a>
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

function DefaultModeRow({
  kind,
  target,
  mode,
  material,
}: {
  kind: ItemKind;
  target: InflateTarget;
  mode: ModeId | undefined;
  material: MaterialId | undefined;
}) {
  const builtIn = defaultModeFor(kind, target);
  const builtInLabel = modeDef(kind, builtIn)?.label ?? builtIn;
  const builtInMaterial = defaultMaterialFor(kind, target);
  const builtInMaterialLabel = materialDef(kind, builtInMaterial)?.label ?? builtInMaterial;
  const label = ITEM_KIND_LABELS[kind];
  return (
    <div className="cx-defrow">
      <span className="cx-defrow__label">{label}</span>
      <Select
        aria-label={`Default mode for ${label} items`}
        size="sm"
        value={mode ?? DEFAULT_ITEM}
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
        {modesFor(kind).map((m) => (
          <ListBoxItem key={m.id} id={m.id} textValue={m.label} description={m.description}>
            {m.label}
          </ListBoxItem>
        ))}
      </Select>
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
          <ListBoxItem key={m.id} id={m.id} textValue={m.label} description={m.description}>
            {m.label}
          </ListBoxItem>
        ))}
      </Select>
    </div>
  );
}

export function SourcesPane() {
  const working = useStore($working);
  if (working === null) return null;
  const preamble = working.preamble ?? '';
  const customDefaults = ITEM_KINDS.filter(
    (k) => working.defaults[k]?.mode !== undefined || working.defaults[k]?.material !== undefined,
  ).length;
  return (
    <section
      className="cx-forge__pane cx-forge__pane--discover"
      aria-labelledby="inflate-sources-h"
      data-testid="inflate-sources"
    >
      <header className="cx-forge__pane-header">
        <h2 id="inflate-sources-h" className="cx-forge__pane-title">
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
        <Disclosure
          title="Default modes"
          meta={customDefaults === 0 ? 'built-in' : `${customDefaults} custom`}
        >
          <div className="cx-defmodes">
            {ITEM_KINDS.map((kind) => (
              <DefaultModeRow
                key={kind}
                kind={kind}
                target={working.target}
                mode={working.defaults[kind]?.mode}
                material={working.defaults[kind]?.material}
              />
            ))}
          </div>
        </Disclosure>
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
