// "Agent sessions" dialog (plans/AGENT_HISTORY_SPEC.md §7), opened by `+ Session` in the Files panel of an okf
// bundle: the agent session histories ctxman finds (Claude Code, Codex, GitHub Copilot CLI + VS Code chat), most
// recent activity first, filtered by agent chip and server search, 50 per page with Load more. The selected session
// is previewed as exactly the markdown an import writes (its info table opens it; Tool calls / Thinking refetch it,
// a "truncated" badge beside them says when it was cut); Import writes it to the typed bundle path
// (POST /api/agent-sessions/import) and opens the new doc page. 409 (the path exists) stays here and says so.
// Browser-only; kit parts by file (no Monaco).
import { useCallback, useState } from 'react';
import type { AgentSessionDetail, AgentSessionSummary } from '../../lib/agent-history/types.ts';
import { allowUnload } from '../edit/unload-guard.ts';
import { Badge } from '../kit/Badge.tsx';
import { Checkbox } from '../kit/Checkbox.tsx';
import { getSession, importSession, listSessions, SESSION_PAGE_SIZE } from './agent-api.ts';
import type { AgentFilter } from './agent-api.ts';
import {
  countText,
  effectiveKey,
  importFailureText,
  importPathState,
  importTitleProblem,
  keyDelta,
  moveSelection,
  sessionTimeIso,
  shortCwd,
  titleOverride,
} from './agent-helpers.ts';
import {
  AgentColumns,
  AgentEmpty,
  AgentImportForm,
  AgentImportFrame,
  AgentList,
  AgentListStatus,
  AgentMore,
  AgentPreview,
  AgentRow,
  AgentToolbar,
} from './AgentImportLayout.tsx';
import type { PreviewState } from './AgentImportLayout.tsx';
import { useAgentDetail, useAgentList, useDebouncedValue } from './useAgentData.ts';
import type { PageFetcher } from './useAgentData.ts';

const PREFIX = 'session';
const FORM_ID = 'session-import-form';
const SEARCH_DEBOUNCE_MS = 250;

const fetchSessionPage: PageFetcher<AgentSessionSummary> = (agent, q, offset, signal) =>
  listSessions({ agent, q, offset, limit: SESSION_PAGE_SIZE }, signal);

/** The user's edits of the form, for one session (another selection starts from its defaults again). */
interface Draft {
  key: string;
  /** null = untouched: the field shows the default. */
  path: string | null;
  title: string | null;
}

export interface ImportSessionDialogProps {
  dataset: string;
  slug: string;
  onClose: () => void;
}

export function ImportSessionDialog({ dataset, slug, onClose }: ImportSessionDialogProps) {
  const [agent, setAgent] = useState<AgentFilter>('all');
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const list = useAgentList(fetchSessionPage, agent, q);
  const [picked, setPicked] = useState<string | null>(null);
  const [tools, setTools] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null);

  const keys = list.items.map((s) => s.key);
  const selected = effectiveKey(keys, picked);
  const row = list.items.find((s) => s.key === selected) ?? null;

  const fetchDetail = useCallback(
    (key: string, signal: AbortSignal) => getSession(key, { tools, thinking }, signal),
    [tools, thinking],
  );
  const detail = useAgentDetail<AgentSessionDetail>(fetchDetail, selected);
  const loaded = detail.data;

  const mine = draft !== null && draft.key === selected ? draft : null;
  const pathValue = mine?.path ?? loaded?.defaultPath ?? '';
  const titleDefault = loaded?.summary.title ?? row?.title ?? '';
  const titleValue = mine?.title ?? titleDefault;
  const pathState = importPathState(pathValue);
  // an untouched title is the agent's own (the server's default, not sent): only an edited one is checked
  const titleProblem = mine === null || mine.title === null ? null : importTitleProblem(mine.title);
  const canImport = selected !== null && loaded !== null && pathState.ok && titleProblem === null;
  const error = failure !== null && failure.key === selected ? failure.text : null;

  function edit(change: { path?: string; title?: string }) {
    if (selected === null) return;
    setDraft({
      key: selected,
      path: change.path ?? mine?.path ?? null,
      title: change.title ?? mine?.title ?? null,
    });
    setFailure(null);
  }

  async function submit() {
    if (!canImport || pending || selected === null || loaded === null) return;
    setPending(true);
    setFailure(null);
    const title = titleOverride(titleValue, loaded.summary.title);
    const res = await importSession({
      key: selected,
      dataset,
      slug,
      path: pathState.path,
      ...(title === undefined ? {} : { title }),
      tools,
      thinking,
    });
    if (res.ok) {
      allowUnload();
      location.assign(res.body.url);
      return; // stays pending until the navigation
    }
    setPending(false);
    setFailure({ key: selected, text: importFailureText(res, pathState.path) });
  }

  const preview: PreviewState =
    selected === null
      ? { kind: 'idle' }
      : loaded !== null
        ? { kind: 'ready', html: loaded.html, stale: detail.loading }
        : detail.error !== null
          ? { kind: 'error', message: detail.error, onRetry: detail.retry }
          : { kind: 'loading' };

  const filtered = q !== '' || agent !== 'all';
  // typed but not searched yet (the 250 ms pause) counts as busy too
  const busy = list.stale || query.trim() !== q;
  const count = countText(
    {
      initial: list.initial,
      busy,
      failed: list.error !== null,
      count: list.items.length,
      more: list.hasMore,
    },
    'session',
    'sessions',
  );
  const empty = !list.initial && !list.stale && list.error === null && list.items.length === 0;

  return (
    <AgentImportFrame
      prefix={PREFIX}
      title="Agent sessions"
      formId={FORM_ID}
      canImport={canImport}
      pending={pending}
      onClose={onClose}
      toolbar={
        <AgentToolbar
          prefix={PREFIX}
          searchLabel="Search sessions"
          placeholder="Search title, first prompt, directory, branch…"
          query={query}
          onQuery={setQuery}
          agent={agent}
          onAgent={setAgent}
          onMove={(key) => {
            const delta = keyDelta(key);
            if (delta === 0) return false;
            const next = moveSelection(keys, selected, delta);
            if (next !== null) setPicked(next);
            return true;
          }}
          count={count}
        />
      }
    >
      {empty ? (
        <AgentEmpty
          testId={`${PREFIX}-empty`}
          title={filtered ? 'No sessions match' : 'No agent sessions found'}
          hint={
            filtered
              ? 'Try another search or agent. ctxman searched these locations:'
              : 'ctxman reads the session histories of Claude Code, Codex and GitHub Copilot from these locations:'
          }
          sources={list.sources}
        />
      ) : (
        <AgentColumns
          list={
            list.items.length === 0 ? (
              <AgentListStatus prefix={PREFIX} error={list.error} onRetry={list.retry} />
            ) : (
              <AgentList
                label="Sessions"
                testId={`${PREFIX}-list`}
                selected={selected}
                onSelect={setPicked}
                stale={busy}
                after={
                  list.hasMore || list.moreError !== null ? (
                    <AgentMore
                      testId={`${PREFIX}-more`}
                      loading={list.moreLoading}
                      error={list.moreError}
                      onMore={list.loadMore}
                    />
                  ) : undefined
                }
              >
                {list.items.map((s) => (
                  <AgentRow
                    key={s.key}
                    id={s.key}
                    testId={`${PREFIX}-row`}
                    agent={s.agent}
                    source={s.source}
                    title={s.title}
                    timeIso={sessionTimeIso(s)}
                    timeLabel="Last activity"
                    details={
                      s.cwd !== undefined && s.cwd !== '' ? (
                        <code
                          className="cx-agentrow__item cx-truncate"
                          title={s.gitBranch === undefined ? s.cwd : `${s.cwd} (${s.gitBranch})`}
                        >
                          {shortCwd(s.cwd)}
                        </code>
                      ) : undefined
                    }
                  />
                ))}
              </AgentList>
            )
          }
          side={
            <>
              <AgentPreview
                prefix={PREFIX}
                scrollKey={loaded === null ? null : loaded.summary.key}
                meta={null}
                state={preview}
              />
              <AgentImportForm
                prefix={PREFIX}
                formId={FORM_ID}
                bundle={`${dataset}/${slug}`}
                path={pathValue}
                onPath={(v) => edit({ path: v })}
                pathState={pathState}
                title={titleValue}
                onTitle={(v) => edit({ title: v })}
                titleError={titleProblem}
                error={error}
                isDisabled={selected === null || loaded === null || pending}
                options={
                  <>
                    <Checkbox
                      isSelected={tools}
                      onChange={setTools}
                      data-testid={`${PREFIX}-opt-tools`}
                    >
                      Tool calls
                    </Checkbox>
                    <Checkbox
                      isSelected={thinking}
                      onChange={setThinking}
                      data-testid={`${PREFIX}-opt-thinking`}
                    >
                      Thinking
                    </Checkbox>
                    {loaded?.truncated === true && (
                      <Badge
                        tone="warn"
                        title="Long messages or later prompts were cut to keep the file small"
                      >
                        <span data-testid={`${PREFIX}-truncated`}>truncated</span>
                      </Badge>
                    )}
                  </>
                }
                onSubmit={() => void submit()}
              />
            </>
          }
        />
      )}
    </AgentImportFrame>
  );
}
