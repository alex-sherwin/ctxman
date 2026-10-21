// Browser-only hooks of the Import session / Import plan dialogs (plans/AGENT_HISTORY_SPEC.md §7): the debounced
// search text, the list (first page on every filter change, aborted when the filter changes again; Load more appends
// the next page) and the preview detail of the selected row (fetched after a short pause, so holding an arrow key
// does not request every row). Results are kept with the request they answer, so "loading" is derived in render and
// no effect sets state synchronously (react-hooks-js/set-state-in-effect).
import { useEffect, useState } from 'react';
import type { AgentSourceStatus } from '../../lib/agent-history/types.ts';
import { failureText } from '../edit/api.ts';
import type { ApiResult } from '../edit/api.ts';
import type { AgentFilter } from './agent-api.ts';
import { mergeByKey } from './agent-helpers.ts';

/** `value` once it has not changed for `ms` (the search field: 250 ms). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// ---------------------------------------------------------------- the list

export interface ListPage<T> {
  items: T[];
  /** The offset of the next page; null (or absent: the plan list has one page) at the end. */
  next?: number | null;
  sources: AgentSourceStatus[];
}

/** Fetches one page. Pass a MODULE-LEVEL function: its identity is an effect dependency. */
export type PageFetcher<T> = (
  agent: AgentFilter,
  q: string,
  offset: number,
  signal?: AbortSignal,
) => Promise<ApiResult<ListPage<T>>>;

type ListResult<T> =
  | { key: string; ok: true; items: T[]; next: number | null; sources: AgentSourceStatus[] }
  | { key: string; ok: false; message: string };

type MoreResult = { key: string; loading: true } | { key: string; loading: false; message: string };

export interface AgentListState<T> {
  /** The rows shown: the current filter's, or the previous filter's while the new one loads (`stale`). */
  items: readonly T[];
  sources: readonly AgentSourceStatus[];
  /** Another page exists (`Load more`). */
  hasMore: boolean;
  /** Nothing loaded yet. */
  initial: boolean;
  /** The rows belong to the previous filter; the current one is loading. */
  stale: boolean;
  /** The current filter's request failed (null while it loads). */
  error: string | null;
  retry: () => void;
  loadMore: () => void;
  moreLoading: boolean;
  moreError: string | null;
}

export function useAgentList<T extends { key: string }>(
  fetchPage: PageFetcher<T>,
  agent: AgentFilter,
  q: string,
): AgentListState<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ListResult<T> | null>(null);
  const [more, setMore] = useState<MoreResult | null>(null);
  const key = `${agent}\n${q}\n${attempt}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const requestKey = `${agent}\n${q}\n${attempt}`;
    void fetchPage(agent, q, 0, ctrl.signal).then((res) => {
      if (ctrl.signal.aborted) return;
      setResult(
        res.ok
          ? {
              key: requestKey,
              ok: true,
              items: res.body.items,
              next: res.body.next ?? null,
              sources: res.body.sources,
            }
          : { key: requestKey, ok: false, message: failureText(res) },
      );
    });
    return () => ctrl.abort();
  }, [fetchPage, agent, q, attempt]);

  const current = result !== null && result.key === key;
  // the previous filter's rows stay on screen (stale) while the next one loads
  const shown = result !== null && result.ok ? result : null;
  const error = current && result !== null && !result.ok ? result.message : null;
  const moreNow = more !== null && more.key === key ? more : null;

  function loadMore() {
    if (shown === null || !current || shown.next === null || moreNow?.loading === true) return;
    const offset = shown.next;
    setMore({ key, loading: true });
    void fetchPage(agent, q, offset).then((res) => {
      if (!res.ok) {
        const message = failureText(res);
        setMore((m) => (m !== null && m.key === key ? { key, loading: false, message } : m));
        return;
      }
      setResult((r) =>
        r !== null && r.ok && r.key === key
          ? { ...r, items: mergeByKey(r.items, res.body.items), next: res.body.next ?? null }
          : r,
      );
      setMore((m) => (m !== null && m.key === key ? null : m));
    });
  }

  return {
    items: shown?.items ?? [],
    sources: shown?.sources ?? [],
    hasMore: current && shown !== null && shown.next !== null,
    initial: shown === null && error === null,
    stale: !current,
    error,
    retry: () => setAttempt((n) => n + 1),
    loadMore,
    moreLoading: moreNow?.loading === true,
    moreError: moreNow !== null && !moreNow.loading ? moreNow.message : null,
  };
}

// ---------------------------------------------------------------- the detail

/**
 * Fetches the detail of one key. Its identity is an effect dependency: a module-level function, or a `useCallback`
 * over the options it sends (the session preview's Tool calls / Thinking), so a new identity means a new request.
 */
export type DetailFetcher<D> = (key: string, signal: AbortSignal) => Promise<ApiResult<D>>;

interface DetailResult<D> {
  key: string;
  fetcher: DetailFetcher<D>;
  attempt: number;
  res: ApiResult<D>;
}

export interface AgentDetailState<D> {
  /** The loaded detail of the selected key (also while a refetch with other options runs: `loading`). */
  data: D | null;
  error: string | null;
  /** A request for the selected key and options is under way. */
  loading: boolean;
  retry: () => void;
}

/** A pause before the request, so moving through the list with the keyboard only fetches where it stops. */
export const DETAIL_DELAY_MS = 120;

export function useAgentDetail<D>(
  fetchDetail: DetailFetcher<D>,
  key: string | null,
): AgentDetailState<D> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<DetailResult<D> | null>(null);

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void fetchDetail(key, ctrl.signal).then((res) => {
        if (!ctrl.signal.aborted) setResult({ key, fetcher: fetchDetail, attempt, res });
      });
    }, DETAIL_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [fetchDetail, key, attempt]);

  const shown = result !== null && result.key === key ? result : null;
  const loading =
    key !== null && (shown === null || shown.fetcher !== fetchDetail || shown.attempt !== attempt);
  return {
    data: shown !== null && shown.res.ok ? shown.res.body : null,
    error: shown !== null && !shown.res.ok && !loading ? failureText(shown.res) : null,
    loading,
    retry: () => setAttempt((n) => n + 1),
  };
}
