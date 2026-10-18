// Right pane of the Forge: pick a context, edit it as a form or as raw YAML, save / revert / delete
// (UI_SPEC §H.5, §H.7). All state lives in src/stores/forge.ts; this file renders it and calls actions.
import { useStore } from '@nanostores/react';
import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { $entries } from '../../stores/entries.ts';
import {
  $baseline,
  $contextLoad,
  $dirty,
  $draftRestored,
  $forgeUrl,
  $newContextPrefill,
  $saveStatus,
  $view,
  $working,
  $yamlCheck,
  $yamlDraft,
  $yamlInvalid,
  $yamlMarkers,
  deleteContext,
  linkKey,
  moveLink,
  removeLink,
  reorderLinks,
  retryLoad,
  revert,
  save,
  saveIfDirty,
  selectContext,
  setContextTags,
  setDescription,
  setView,
  setYamlDraft,
} from '../../stores/forge.ts';
import { $now } from '../../stores/now.ts';
import { isMac, modKeyLabel } from '../../stores/platform.ts';
import { DraftNotice } from '../edit/DraftNotice.tsx';
import { saveStatusView } from '../edit/status.ts';
import { TagEditor } from '../edit/TagEditor.tsx';
import { YamlIssues } from '../edit/YamlIssues.tsx';
import {
  Button,
  ButtonLink,
  ChipToggle,
  CodeEditor,
  ConfirmDialog,
  EmptyState,
  Kbd,
  ListBoxItem,
  Loading,
  OrderedList,
  Select,
  Status,
  TextField,
} from '../kit/index.ts';
import type { CodeEditorApi } from '../kit/index.ts';
import { LinkRow } from './LinkRow.tsx';
import { isMissing, labelOf } from './link-label.ts';

const NEW_ITEM = '__new__';

// ---------------------------------------------------------------- header

function ContextSelect() {
  const url = useStore($forgeUrl);
  const entries = useStore($entries);
  const contexts = [...(entries.context?.entries ?? [])].sort((a, b) =>
    a.slug.localeCompare(b.slug, 'en'),
  );
  const current = url.context === 'new' ? null : url.context;
  // The selected slug may not be in the list yet (loading) or at all (not found): keep it selectable.
  const known = current === null || contexts.some((c) => c.slug === current);
  return (
    <Select
      aria-label="Context"
      placeholder="Select a context…"
      value={current}
      onChange={(key) =>
        selectContext(key === NEW_ITEM ? 'new' : key === null ? null : String(key))
      }
      size="sm"
      pinnedKeys={[NEW_ITEM]}
      triggerTestId="forge-context-select"
      className="cx-forge__ctxselect"
    >
      {contexts.map((c) => (
        <ListBoxItem key={c.slug} id={c.slug} textValue={c.slug} description={c.description}>
          {c.slug}
        </ListBoxItem>
      ))}
      {!known && current !== null && (
        <ListBoxItem key={current} id={current} textValue={current}>
          {current}
        </ListBoxItem>
      )}
      <ListBoxItem id={NEW_ITEM} textValue="New context…" data-testid="forge-context-new">
        + New context…
      </ListBoxItem>
    </Select>
  );
}

function ViewToggle() {
  const view = useStore($view);
  const check = useStore($yamlCheck);
  return (
    <>
      <ChipToggle
        label="Editor view"
        value={view}
        onChange={setView}
        testId="forge-view-toggle"
        options={[
          {
            id: 'form',
            label: 'Form',
            testId: 'forge-view-form',
            isDisabled: view === 'yaml' && !check.ok,
          },
          { id: 'yaml', label: 'YAML', testId: 'forge-view-yaml' },
        ]}
      />
      {view === 'yaml' && !check.ok && (
        <span className="cx-subtle cx-forge__hint">
          Fix YAML errors to return to the form (or Revert)
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------- form view

function FormView() {
  const working = useStore($working);
  const entries = useStore($entries);
  const yamlInvalid = useStore($yamlInvalid);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** The reorder / remove button of the row `key` (the DOM is the source of truth for focus targets). */
  const buttonOf = useCallback((key: string, testId: string): HTMLButtonElement | null => {
    const row = listRef.current?.querySelector(`[role="row"][data-key="${CSS.escape(key)}"]`);
    const button = row?.querySelector(`[data-testid="${testId}"]`);
    return button instanceof HTMLButtonElement ? button : null;
  }, []);

  if (working === null) return null;
  const links = working.links;

  function onMove(key: string, dir: -1 | 1) {
    flushSync(() => moveLink(key, dir));
    // Keep the focus on the same-direction button of the moved row; at the end of the list that
    // button is disabled, so fall back to the opposite one.
    const same = buttonOf(key, dir === -1 ? 'forge-link-up' : 'forge-link-down');
    const target =
      same !== null && !same.disabled
        ? same
        : buttonOf(key, dir === -1 ? 'forge-link-down' : 'forge-link-up');
    target?.focus();
  }

  function onRemove(key: string) {
    const i = links.findIndex((l) => linkKey(l) === key);
    const neighbour = links[i + 1] ?? links[i - 1];
    flushSync(() => removeLink(key));
    const target =
      neighbour === undefined ? null : buttonOf(linkKey(neighbour), 'forge-link-remove');
    (target ?? headingRef.current)?.focus();
  }

  return (
    <div className="cx-ctx">
      <div className="cx-ctx__meta">
        <TextField
          label="Name"
          value={working.name}
          isReadOnly
          mono
          description="Name is the file name and slug; it can't be changed."
          inputTestId="forge-context-name"
        />
        <TextField
          label="Description"
          value={working.description}
          onChange={setDescription}
          isRequired
          inputTestId="forge-context-description"
        />
        <TagEditor
          tags={working.tags ?? []}
          onChange={setContextTags}
          testIdPrefix="forge"
          className="cx-ctx__tags"
        />
      </div>
      <div className="cx-ctx__linkshead">
        <h3 id="forge-links-h" className="cx-label" ref={headingRef} tabIndex={-1}>
          Links <span className="cx-subtle">({links.length})</span>
        </h3>
      </div>
      {links.length === 0 ? (
        <EmptyState title="No links yet">Add entries from the Discover pane.</EmptyState>
      ) : (
        <OrderedList
          aria-labelledby="forge-links-h"
          items={links}
          getKey={linkKey}
          getLabel={(l) => labelOf(entries, l)}
          onReorder={reorderLinks}
          testId="forge-links"
          rowTestId="forge-link"
          handleTestId="forge-link-handle"
          rowAttrs={(l) => ({
            'data-ds': l.dataset,
            'data-missing': isMissing(entries, l) ? '' : undefined,
          })}
          dependencies={[entries]}
          isDragDisabled={yamlInvalid}
          ref={listRef}
        >
          {(link, i) => (
            <LinkRow
              link={link}
              index={i}
              count={links.length}
              onMove={onMove}
              onRemove={onRemove}
            />
          )}
        </OrderedList>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- YAML view

function YamlView({ name }: { name: string }) {
  const draft = useStore($yamlDraft);
  const check = useStore($yamlCheck);
  const markers = useStore($yamlMarkers);
  const api = useRef<CodeEditorApi | null>(null);
  return (
    <div className="cx-yaml" data-testid="forge-yaml">
      <CodeEditor
        language="yaml"
        value={draft ?? ''}
        onChange={setYamlDraft}
        height={{ mode: 'fill' }}
        ariaLabel={`YAML for context ${name}`}
        testId="forge-yaml-editor"
        markers={markers}
        schemaDataset="context"
        onSave={saveIfDirty}
        onReady={(editor) => {
          api.current = editor;
        }}
        describedBy="forge-yaml-help"
      />
      <p id="forge-yaml-help" className="cx-yaml__help">
        Edits sync to the form when valid. Comments and formatting are not preserved. Tab indents;
        press {isMac ? 'Ctrl+Shift+M' : 'Ctrl+M'} to make Tab move focus.
      </p>
      <YamlIssues
        issues={check.issues}
        onReveal={(line, column) => api.current?.revealPosition(line, column)}
        testIdPrefix="forge"
      />
    </div>
  );
}

// ---------------------------------------------------------------- footer

/** The only component that ticks every second (relative "Saved 5 seconds ago"). */
function StatusLine() {
  const dirty = useStore($dirty);
  const check = useStore($yamlCheck);
  const status = useStore($saveStatus);
  const now = useStore($now);

  const view = saveStatusView(status, dirty, now, check.ok ? 0 : check.issues.length);
  return (
    <Status kind={view.kind} testId="forge-status" className="cx-forge__status">
      {view.text}
    </Status>
  );
}

function ContextFooter({ name }: { name: string }) {
  const dirty = useStore($dirty);
  const invalid = useStore($yamlInvalid);
  const status = useStore($saveStatus);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    setDeleting(true);
    await deleteContext();
    setDeleting(false);
    setConfirmOpen(false);
  }

  return (
    <footer className="cx-forge__footer">
      <Button
        variant="primary"
        onPress={() => void save()}
        isDisabled={!dirty || invalid}
        isPending={status.kind === 'saving'}
        data-testid="forge-save"
      >
        Save <Kbd>{modKeyLabel}S</Kbd>
      </Button>
      <Button onPress={revert} isDisabled={!dirty && !invalid} data-testid="forge-revert">
        Revert
      </Button>
      <Button variant="ghost" onPress={() => setConfirmOpen(true)} data-testid="forge-delete">
        Delete…
      </Button>
      <StatusLine />
      <ConfirmDialog
        isOpen={confirmOpen}
        title={`Delete context "${name}"?`}
        confirmLabel="Delete"
        tone="danger"
        isPending={deleting}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmOpen(false)}
        testId="forge-delete-dialog"
      >
        This deletes data/context/{name}.yaml. Linked entries are not affected.
      </ConfirmDialog>
    </footer>
  );
}

// ---------------------------------------------------------------- pane

/** The working copy came back from a saved draft (a reload, a dev reload): say so, offer Discard. */
function RestoredDraft() {
  const restored = useStore($draftRestored);
  const dirty = useStore($dirty);
  if (restored === null || !dirty) return null;
  return <DraftNotice testIdPrefix="forge" stale={restored.stale} onDiscard={revert} />;
}

function Body() {
  const url = useStore($forgeUrl);
  const load = useStore($contextLoad);
  const working = useStore($working);
  const view = useStore($view);
  const status = useStore($saveStatus);

  if (working !== null) return view === 'yaml' ? <YamlView name={working.name} /> : <FormView />;

  if (load.status === 'loading') {
    return <Loading label="Loading context…" />;
  }
  if (load.status === 'not-found' && url.context !== null && url.context !== 'new') {
    const slug = url.context;
    return (
      <EmptyState
        title={`No context named "${slug}"`}
        action={
          <Button
            variant="primary"
            onPress={() => {
              $newContextPrefill.set(slug);
              selectContext('new');
            }}
          >
            Create {slug}
          </Button>
        }
      />
    );
  }
  if (load.status === 'error') {
    return (
      <EmptyState
        title="Couldn't load this context"
        action={<Button onPress={retryLoad}>Retry</Button>}
      >
        {load.message}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      title="No context selected"
      action={
        <>
          <Button
            variant="primary"
            onPress={() => selectContext('new')}
            data-testid="forge-empty-new"
          >
            New context
          </Button>
          {status.kind === 'deleted' && (
            <Status kind="saved" testId="forge-status" className="cx-forge__status">
              {status.message}
            </Status>
          )}
        </>
      }
    >
      Pick a context above or create a new one. Contexts are evergreen pointers to entries — content
      is never copied.
    </EmptyState>
  );
}

export function ContextPane() {
  const working = useStore($working);
  const view = useStore($view);
  const baseline = useStore($baseline);
  return (
    <section
      className="cx-forge__pane"
      aria-labelledby="forge-context-h"
      data-testid="forge-context"
    >
      <header className="cx-forge__pane-header">
        <h2 id="forge-context-h" className="cx-forge__pane-title ck-label">
          Context
        </h2>
        <ContextSelect />
        {working && <ViewToggle />}
        {working && (
          <ButtonLink
            variant="ghost"
            size="sm"
            href={`/context/${working.name}`}
            data-testid="forge-view-context"
          >
            View page ↗
          </ButtonLink>
        )}
      </header>
      <RestoredDraft />
      <div className="cx-forge__pane-body" data-view={working ? view : 'form'}>
        <Body />
      </div>
      {working && baseline && <ContextFooter name={working.name} />}
    </section>
  );
}
