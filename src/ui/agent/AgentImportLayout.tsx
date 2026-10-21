// The layout the Import session and Import plan dialogs share (plans/AGENT_HISTORY_SPEC.md §7): an xlarge Modal whose
// body is a toolbar (search, agent chips, count) over two columns, the selectable list on the left (a fixed width)
// and, on the right, the rendered preview (a plan adds a one-line meta strip above it; a session's own info table
// opens its preview) and the import form under it (options, then Path and Title on full-width rows; Cancel + Import
// in the footer). The body never scrolls; the list and the preview scroll inside. Times on screen are local and say
// so; the imported file keeps UTC. Browser-only; kit parts by file (no Monaco).
import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Form } from 'react-aria-components';
import { AGENT_LABELS, AGENT_SOURCE_LABELS } from '../../lib/agent-history/types.ts';
import type { AgentId, AgentSource, AgentSourceStatus } from '../../lib/agent-history/types.ts';
import { $now } from '../../stores/now.ts';
import { Badge } from '../kit/Badge.tsx';
import { Button } from '../kit/Button.tsx';
import { ChipToggle } from '../kit/Chip.tsx';
import { Dialog, FormDialogFooter, Modal } from '../kit/Dialog.tsx';
import { EmptyState } from '../kit/EmptyState.tsx';
import { SearchField, TextField } from '../kit/Field.tsx';
import { GridList, GridListItem } from '../kit/GridList.tsx';
import { Loading } from '../kit/Loading.tsx';
import { ErrorText } from '../kit/Status.tsx';
import type { AgentFilter } from './agent-api.ts';
import {
  agentFilterOptions,
  agentSourceText,
  AGENT_SHORT_LABELS,
  localTimeTitle,
  relativeTime,
} from './agent-helpers.ts';
import type { ImportPathState, MetaItem } from './agent-helpers.ts';

// ---------------------------------------------------------------- frame

export interface AgentImportFrameProps {
  /** Test id prefix: `session` or `plan` (`<prefix>-dialog`, `<prefix>-import-submit`, …). */
  prefix: string;
  title: string;
  /** `id` of the import `<Form>` the footer's Import button submits. */
  formId: string;
  canImport: boolean;
  pending: boolean;
  onClose: () => void;
  toolbar: ReactNode;
  /** The two columns, or the empty state that replaces them. */
  children: ReactNode;
}

export function AgentImportFrame({
  prefix,
  title,
  formId,
  canImport,
  pending,
  onClose,
  toolbar,
  children,
}: AgentImportFrameProps) {
  return (
    <Modal
      isOpen
      isDismissable={!pending}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="xlarge"
      testId={`${prefix}-dialog`}
    >
      <Dialog
        title={title}
        bodyClassName="cx-agentdlg__body"
        footer={
          <FormDialogFooter
            formId={formId}
            submitLabel="Import"
            onCancel={onClose}
            isDisabled={!canImport}
            isPending={pending}
            cancelTestId={`${prefix}-import-cancel`}
            submitTestId={`${prefix}-import-submit`}
          />
        }
      >
        <div className="cx-agentdlg__toolbar">{toolbar}</div>
        {children}
      </Dialog>
    </Modal>
  );
}

/** The list column and the side column (meta, preview, form). */
export function AgentColumns({ list, side }: { list: ReactNode; side: ReactNode }) {
  return (
    <div className="cx-agentdlg__cols">
      {list}
      <div className="cx-agentdlg__side">{side}</div>
    </div>
  );
}

// ---------------------------------------------------------------- toolbar

export interface AgentToolbarProps {
  prefix: string;
  /** `aria-label` and placeholder of the search field. */
  searchLabel: string;
  placeholder: string;
  query: string;
  onQuery: (value: string) => void;
  agent: AgentFilter;
  onAgent: (agent: AgentFilter) => void;
  /** A key pressed in the search field; true = it moved the list selection (ArrowDown / ArrowUp …): no caret move. */
  onMove: (key: string) => boolean;
  /** "52 sessions", "Loading…". */
  count: string;
}

export function AgentToolbar({
  prefix,
  searchLabel,
  placeholder,
  query,
  onQuery,
  agent,
  onAgent,
  onMove,
  count,
}: AgentToolbarProps) {
  return (
    <>
      <SearchField
        aria-label={searchLabel}
        value={query}
        onChange={onQuery}
        onKeyDown={(e) => {
          // react-aria stops every key a custom onKeyDown does not release: Esc must still clear / close
          e.continuePropagation();
          if (onMove(e.key)) e.preventDefault();
        }}
        autoFocus
        size="sm"
        placeholder={placeholder}
        className="cx-agentdlg__search"
        inputTestId={`${prefix}-search`}
      />
      <ChipToggle
        label="Agent"
        value={agent}
        onChange={onAgent}
        options={agentFilterOptions(prefix)}
        testId={`${prefix}-agents`}
      />
      <span className="cx-agentdlg__count" role="status" data-testid={`${prefix}-count`}>
        {count}
      </span>
    </>
  );
}

// ---------------------------------------------------------------- list

export interface AgentListProps {
  /** `aria-label` of the grid. */
  label: string;
  /** `data-testid` of the grid (`session-list`, `plan-list`). */
  testId: string;
  selected: string | null;
  onSelect: (key: string) => void;
  /** The previous filter's rows while the next one loads: dimmed. */
  stale?: boolean;
  /** `AgentRow`s. */
  children: ReactNode;
  /** Under the rows, inside the scroll box (Load more). */
  after?: ReactNode;
}

export function AgentList({
  label,
  testId,
  selected,
  onSelect,
  stale,
  children,
  after,
}: AgentListProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  // a selection moved from the search field (arrow keys) scrolls its row into view
  useEffect(() => {
    if (selected === null) return;
    const row = boxRef.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="cx-agentdlg__list" ref={boxRef} data-stale={stale ? '' : undefined}>
      <GridList
        aria-label={label}
        selectionMode="single"
        selectionBehavior="replace"
        disallowEmptySelection
        selectedKeys={selected === null ? [] : [selected]}
        onSelectionChange={(keys) => {
          if (keys === 'all') return;
          const key = [...keys][0];
          if (key !== undefined) onSelect(String(key));
        }}
        data-testid={testId}
      >
        {children}
      </GridList>
      {after}
    </div>
  );
}

/**
 * The relative time of a row, its local date and time in the tooltip ("Last activity 2026-10-21 14:03, local time").
 * It reads the ticking `$now` store itself, so the clock re-renders these spans and not the whole list.
 */
function RowTime({ iso, label }: { iso: string; label: string }) {
  const now = useStore($now);
  return (
    <time className="cx-agentrow__time" dateTime={iso} title={localTimeTitle(label, iso)}>
      {relativeTime(iso, now)}
    </time>
  );
}

export interface AgentRowProps {
  /** The agent key (RAC id and `data-key`). */
  id: string;
  testId: string;
  agent: AgentId;
  source: AgentSource;
  title: string;
  /** ISO date-time of the row (a session's last activity, a plan's mtime), shown relative ("3 hours ago"). */
  timeIso: string;
  /** What the time is, for its tooltip: "Last activity", "Modified". */
  timeLabel: string;
  /** Lines between the title and the meta line (a plan's excerpt). */
  children?: ReactNode;
  /** Inline items of the meta line, after the badges (directory, branch, file). */
  details?: ReactNode;
}

/**
 * One row: the title on its own line (the list column is narrow), the caller's lines, then the meta line: agent badge
 * (+ source badge), the caller's details and the relative time.
 */
export function AgentRow({
  id,
  testId,
  agent,
  source,
  title,
  timeIso,
  timeLabel,
  children,
  details,
}: AgentRowProps) {
  const sourceLabel = AGENT_SOURCE_LABELS[source];
  return (
    <GridListItem
      id={id}
      textValue={title}
      className="cx-agentrow"
      data-testid={testId}
      data-key={id}
      data-agent={agent}
      data-source={source}
    >
      <span className="cx-agentrow__title cx-truncate" title={title}>
        {title}
      </span>
      {children}
      <span className="cx-agentrow__sub">
        <Badge mono title={AGENT_LABELS[agent]}>
          {AGENT_SHORT_LABELS[agent]}
        </Badge>
        {sourceLabel !== '' && <Badge tone="muted">{sourceLabel}</Badge>}
        {details}
        <RowTime iso={timeIso} label={timeLabel} />
      </span>
    </GridListItem>
  );
}

export interface AgentMoreProps {
  testId: string;
  loading: boolean;
  error: string | null;
  onMore: () => void;
}

/** `Load more` under the rows (sessions; while the server has another page). */
export function AgentMore({ testId, loading, error, onMore }: AgentMoreProps) {
  return (
    <div className="cx-agentdlg__more">
      <Button
        size="sm"
        variant="secondary"
        isPending={loading}
        onPress={onMore}
        data-testid={testId}
      >
        Load more
      </Button>
      {error !== null && <ErrorText testId={`${testId}-error`}>{error}</ErrorText>}
    </div>
  );
}

/** The list column while nothing is shown yet, or when the list failed (with Retry). */
export function AgentListStatus({
  prefix,
  error,
  onRetry,
}: {
  prefix: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="cx-agentdlg__list">
      {error === null ? (
        <Loading testId={`${prefix}-list-loading`} />
      ) : (
        <ErrorText
          as="div"
          className="ck-error--row cx-agentdlg__pad"
          testId={`${prefix}-list-error`}
        >
          <span>{error}</span>
          <Button size="sm" onPress={onRetry}>
            Retry
          </Button>
        </ErrorText>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- empty state

export interface AgentEmptyProps {
  testId: string;
  title: string;
  hint: string;
  sources: readonly AgentSourceStatus[];
}

/** No rows: says so and lists every location ctxman searched, found or not. */
export function AgentEmpty({ testId, title, hint, sources }: AgentEmptyProps) {
  return (
    <div className="cx-agentdlg__empty" data-testid={testId}>
      <EmptyState compact title={title}>
        {hint}
      </EmptyState>
      {sources.length > 0 && (
        <table className="ck-table ck-table--compact cx-agentdlg__sources">
          <caption className="ck-label cx-label cx-agentdlg__caption">Searched locations</caption>
          <tbody className="ck-table__body">
            {sources.map((s) => (
              <tr
                key={`${s.source}\n${s.path}`}
                className="ck-table__row"
                data-testid={`${testId}-source`}
                data-source={s.source}
                data-exists={s.exists ? 'true' : 'false'}
              >
                <td className="ck-table__td cx-nowrap">{agentSourceText(s.agent, s.source)}</td>
                <td className="ck-table__td cx-mono">{s.path}</td>
                <td className="ck-table__td ck-table__td--end">
                  <Badge tone={s.exists ? 'success' : 'muted'}>
                    {s.exists ? 'found' : 'missing'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- preview

export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; onRetry: () => void }
  | { kind: 'ready'; html: string; stale: boolean };

export interface AgentPreviewProps {
  prefix: string;
  /** The key the shown content belongs to: a new one scrolls the preview back to the top. */
  scrollKey: string | null;
  /**
   * One compact line above the preview (a plan's agent, file, directory, thread, time); null for none (a session's
   * preview opens with its own info table: the preview shows exactly the imported file).
   */
  meta: readonly MetaItem[] | null;
  state: PreviewState;
}

export function AgentPreview({ prefix, scrollKey, meta, state }: AgentPreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scrollRef.current;
    if (box !== null) box.scrollTop = 0;
  }, [scrollKey]);

  return (
    <section
      className="cx-agentdlg__preview"
      aria-label="Preview"
      data-testid={`${prefix}-preview`}
      data-state={state.kind === 'ready' && state.stale ? 'refreshing' : state.kind}
    >
      {meta !== null && (
        <dl className="cx-agentdlg__meta" data-testid={`${prefix}-meta`}>
          {meta.map((m) => (
            <div
              key={m.id}
              className="cx-agentdlg__metaitem"
              data-meta={m.id}
              data-grow={m.grow ? '' : undefined}
            >
              <dt className="ck-label cx-label">{m.label}</dt>
              <dd className={m.mono ? 'cx-mono cx-truncate' : 'cx-truncate'} title={m.title}>
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div
        className="cx-agentdlg__scroll"
        ref={scrollRef}
        // a scrollable region must be reachable with the keyboard
        tabIndex={0}
        data-stale={state.kind === 'ready' && state.stale ? '' : undefined}
      >
        {state.kind === 'loading' && <Loading testId={`${prefix}-preview-loading`} />}
        {state.kind === 'error' && (
          <ErrorText as="div" className="ck-error--row" testId={`${prefix}-preview-error`}>
            <span>{state.message}</span>
            <Button size="sm" onPress={state.onRetry}>
              Retry
            </Button>
          </ErrorText>
        )}
        {state.kind === 'ready' && (
          // Server-rendered markdown of the imported text: the server makes it inert (raw HTML escaped, links
          // neutralized), the same trust as a doc page's rendered body.
          <div
            className="cx-prose cx-prose--compact"
            data-testid={`${prefix}-preview-body`}
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- import form

export interface AgentImportFormProps {
  prefix: string;
  formId: string;
  /** `<ds>/<slug>`: shown under the path when the typed path is normalized (e.g. `.md` added). */
  bundle: string;
  path: string;
  onPath: (value: string) => void;
  pathState: ImportPathState;
  title: string;
  onTitle: (value: string) => void;
  /** Shown under the Title field (null = fine, or untouched). */
  titleError: string | null;
  /** The import failed (409 exists, 400 …). */
  error: string | null;
  /** Nothing to import yet (no row selected, its detail not loaded): the fields are disabled. */
  isDisabled: boolean;
  /** Above the fields (the session's Tool calls / Thinking checkboxes and its "truncated" badge). */
  options?: ReactNode;
  onSubmit: () => void;
}

export function AgentImportForm({
  prefix,
  formId,
  bundle,
  path,
  onPath,
  pathState,
  title,
  onTitle,
  titleError,
  error,
  isDisabled,
  options,
  onSubmit,
}: AgentImportFormProps) {
  return (
    <Form
      id={formId}
      className="cx-agentdlg__form"
      validationBehavior="aria"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {options !== undefined && <div className="cx-agentdlg__opts">{options}</div>}
      <div className="cx-agentdlg__fields">
        <TextField
          label="Path"
          mono
          size="sm"
          value={path}
          onChange={onPath}
          isDisabled={isDisabled}
          isInvalid={pathState.problem !== null}
          errorMessage={pathState.problem ?? undefined}
          description={
            pathState.ok && pathState.path !== path.trim()
              ? `Creates ${bundle}/${pathState.path}`
              : undefined
          }
          inputTestId={`${prefix}-import-path`}
        />
        <TextField
          label="Title"
          size="sm"
          value={title}
          onChange={onTitle}
          isDisabled={isDisabled}
          isInvalid={titleError !== null}
          errorMessage={titleError ?? undefined}
          inputTestId={`${prefix}-import-title`}
        />
      </div>
      {error !== null && <ErrorText testId={`${prefix}-import-error`}>{error}</ErrorText>}
    </Form>
  );
}
