// "Agent plans" dialog (plans/AGENT_HISTORY_SPEC.md §7), opened by `+ Plan` in the Files panel of an okf bundle: the
// plan markdown files Claude Code, Codex and GitHub Copilot write, most recently modified first, filtered by agent
// chip and a server search over the whole text. The selected plan is previewed as the markdown an import writes;
// Import writes it to the typed bundle path (POST /api/agent-plans/import) and opens the new doc page. 409 (the path
// exists) stays here and says so. Same layout as the session dialog (AgentImportLayout.tsx). Browser-only; kit parts
// by file (no Monaco).
import { useState } from 'react';
import type { AgentPlanDetail, AgentPlanSummary } from '../../lib/agent-history/types.ts';
import { allowUnload } from '../edit/unload-guard.ts';
import { getPlan, importPlan, listPlans } from './agent-api.ts';
import type { AgentFilter } from './agent-api.ts';
import {
  countText,
  effectiveKey,
  importFailureText,
  importPathState,
  importTitleProblem,
  keyDelta,
  moveSelection,
  planMeta,
  shortPath,
  titleOverride,
} from './agent-helpers.ts';
import {
  AgentColumns,
  AgentEmpty,
  AgentImportForm,
  AgentImportFrame,
  AgentList,
  AgentListStatus,
  AgentPreview,
  AgentRow,
  AgentToolbar,
} from './AgentImportLayout.tsx';
import type { PreviewState } from './AgentImportLayout.tsx';
import { useAgentDetail, useAgentList, useDebouncedValue } from './useAgentData.ts';
import type { DetailFetcher, PageFetcher } from './useAgentData.ts';

const PREFIX = 'plan';
const FORM_ID = 'plan-import-form';
const SEARCH_DEBOUNCE_MS = 250;

// one page: the plan list is not paged
const fetchPlanPage: PageFetcher<AgentPlanSummary> = (agent, q, _offset, signal) =>
  listPlans({ agent, q }, signal);

const fetchPlan: DetailFetcher<AgentPlanDetail> = (key, signal) => getPlan(key, signal);

interface Draft {
  key: string;
  path: string | null;
  title: string | null;
}

export interface ImportPlanDialogProps {
  dataset: string;
  slug: string;
  onClose: () => void;
}

export function ImportPlanDialog({ dataset, slug, onClose }: ImportPlanDialogProps) {
  const [agent, setAgent] = useState<AgentFilter>('all');
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const list = useAgentList(fetchPlanPage, agent, q);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null);

  const keys = list.items.map((p) => p.key);
  const selected = effectiveKey(keys, picked);
  const row = list.items.find((p) => p.key === selected) ?? null;
  const detail = useAgentDetail<AgentPlanDetail>(fetchPlan, selected);
  const loaded = detail.data;

  const mine = draft !== null && draft.key === selected ? draft : null;
  const pathValue = mine?.path ?? loaded?.defaultPath ?? '';
  const titleValue = mine?.title ?? loaded?.summary.title ?? row?.title ?? '';
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
    const res = await importPlan({
      key: selected,
      dataset,
      slug,
      path: pathState.path,
      ...(title === undefined ? {} : { title }),
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
      more: false,
    },
    'plan',
    'plans',
  );
  const empty = !list.initial && !list.stale && list.error === null && list.items.length === 0;

  return (
    <AgentImportFrame
      prefix={PREFIX}
      title="Agent plans"
      formId={FORM_ID}
      canImport={canImport}
      pending={pending}
      onClose={onClose}
      toolbar={
        <AgentToolbar
          prefix={PREFIX}
          searchLabel="Search plans"
          placeholder="Search title, path, thread and the whole text…"
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
          title={filtered ? 'No plans match' : 'No agent plans found'}
          hint={
            filtered
              ? 'Try another search or agent. ctxman searched these locations:'
              : 'ctxman reads the plan files of Claude Code, Codex and GitHub Copilot from these locations:'
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
                label="Plans"
                testId={`${PREFIX}-list`}
                selected={selected}
                onSelect={setPicked}
                stale={busy}
              >
                {list.items.map((p) => (
                  <AgentRow
                    key={p.key}
                    id={p.key}
                    testId={`${PREFIX}-row`}
                    agent={p.agent}
                    source={p.source}
                    title={p.title}
                    timeIso={p.modifiedAt}
                    details={
                      <code className="cx-agentrow__item cx-truncate" title={p.path}>
                        {shortPath(p.path)}
                      </code>
                    }
                  >
                    {p.excerpt !== '' && (
                      <span className="cx-agentrow__excerpt cx-truncate" title={p.excerpt}>
                        {p.excerpt}
                      </span>
                    )}
                  </AgentRow>
                ))}
              </AgentList>
            )
          }
          side={
            <>
              <AgentPreview
                prefix={PREFIX}
                scrollKey={loaded === null ? null : loaded.summary.key}
                meta={row === null ? null : planMeta(row)}
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
                onSubmit={() => void submit()}
              />
            </>
          }
        />
      )}
    </AgentImportFrame>
  );
}
