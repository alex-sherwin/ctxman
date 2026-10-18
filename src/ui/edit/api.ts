// Browser-safe (fetch only; no Monaco, no stores): the JSON helpers every editing island uses. Both
// functions NEVER throw: a network failure resolves to `{ ok: false, status: 0 }`. Error bodies follow
// src/lib/http.ts `apiError`: `{ error, message, issues? }`.

export interface ApiIssue {
  path: string;
  message: string;
}

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: string; message: string; issues?: ApiIssue[] };

export type SendMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIssues(value: unknown): ApiIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const issues: ApiIssue[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.message === 'string') {
      issues.push({ path: typeof item.path === 'string' ? item.path : '', message: item.message });
    }
  }
  return issues;
}

async function readBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

async function run<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: 'network',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const body = await readBody(res);
  if (res.ok) return { ok: true, status: res.status, body: body as T };
  const record = isRecord(body) ? body : {};
  const issues = toIssues(record.issues);
  return {
    ok: false,
    status: res.status,
    error: typeof record.error === 'string' ? record.error : `http-${res.status}`,
    message: typeof record.message === 'string' ? record.message : `HTTP ${res.status}`,
    ...(issues === undefined ? {} : { issues }),
  };
}

/** `GET url` with `accept: application/json`. */
export function getJson<T>(url: string): Promise<ApiResult<T>> {
  return run<T>(url, { headers: { accept: 'application/json' } });
}

/**
 * `method url` with a JSON body (omitted when `body` is undefined). A 204 / empty success has `body`
 * `undefined`, typed as `T` (use `sendJson<null>` for those).
 */
export function sendJson<T>(
  method: SendMethod,
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return run<T>(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
