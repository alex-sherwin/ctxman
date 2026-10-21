// SERVER: JSON responses and request guards shared by every API route (PLAN §E.19, §G).
// Every response is JSON with `cache-control: no-store`; errors are `{ error, message, issues? }`.
// No astro:* imports, so it is unit-testable (tests/unit/http.test.ts).
import { AgentHistoryError } from './agent-history/errors.ts';
import { ContextIoError } from './context-io.ts';
import type { Issue } from './context-io.ts';
import { DocIoError } from './doc-io.ts';
import { EntryIoError } from './entry-io.ts';
import { RecipeIoError } from './recipe-io.ts';
import { ReferenceIoError } from './reference-io.ts';
import { SnippetIoError } from './snippet-io.ts';

/** Statuses that must not carry a body (a `Response` with a body and one of these throws). */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/** JSON response (`Response.json`) with `cache-control: no-store`. Null-body statuses (204...) get no body. */
export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers);
  merged.set('cache-control', 'no-store');
  if (NULL_BODY_STATUSES.has(status)) return new Response(null, { status, headers: merged });
  return Response.json(data, { status, headers: merged });
}

/** 204 with an empty body (DELETE). */
export function noContent(): Response {
  return json(null, 204);
}

/** Error body `{ error: <machine code>, message, issues? }`. */
export function apiError(
  status: number,
  error: string,
  message: string,
  issues?: Issue[],
): Response {
  const body: { error: string; message: string; issues?: Issue[] } = { error, message };
  if (issues !== undefined) body.issues = issues;
  return json(body, status);
}

/** 405 for a method the route does not implement (`export const ALL`). */
export function methodNotAllowed(allowed: readonly string[]): Response {
  const allow = allowed.join(', ');
  return json({ error: 'method-not-allowed', message: `use ${allow}` }, 405, { allow });
}

/** 500 for an unexpected exception; the cause is logged to the server console. */
export function internalError(error: unknown): Response {
  console.error('[ctxman] api error:', error);
  return apiError(500, 'internal', error instanceof Error ? error.message : String(error));
}

/** Hostnames that all mean "this machine" (WHATWG `URL.hostname` keeps the brackets of an IPv6 literal). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * 403 `forbidden-origin` when the request carries an `Origin` header that is not this server's origin
 * (a browser page on another site, or a sandboxed `null` origin). Requests without `Origin` (curl,
 * Playwright's request context, server-to-server) pass. Used by every mutating route, including DELETE.
 *
 * Passes when the Origin equals `url.origin`; or when both parse and have the same protocol and port and
 * either the same hostname or both hostnames are loopback (127.0.0.1 / localhost / ::1 / [::1]): a built
 * Astro node server rebuilds `Request.url` with `localhost` unless the Host is in `security.allowedDomains`,
 * while the browser sends `Origin: http://127.0.0.1:<port>`; or when the `Host` request header (with the
 * url's protocol) equals the Origin's host:port. Everything else, including an unparsable Origin, is 403.
 */
export function checkOrigin(request: Request, url: URL): Response | null {
  const origin = request.headers.get('origin');
  if (origin === null || origin === url.origin) return null;
  if (!originMatches(origin, request.headers.get('host'), url)) {
    return apiError(403, 'forbidden-origin', `cross-origin request from ${origin} is not allowed`);
  }
  return null;
}

function originMatches(origin: string, host: string | null, url: URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== url.protocol) return false;
  if (host !== null && parsed.host === host.toLowerCase()) return true;
  if (parsed.port !== url.port) return false;
  if (parsed.hostname === url.hostname) return true;
  return LOOPBACK_HOSTNAMES.has(parsed.hostname) && LOOPBACK_HOSTNAMES.has(url.hostname);
}

const JSON_CONTENT_TYPE = /^\s*application\/json\s*(?:;|$)/i;

/**
 * Reads a JSON request body with the guards every mutating route needs:
 * 403 `forbidden-origin` (see `checkOrigin`), 415 `unsupported-media-type` unless the content type is
 * `application/json` (also stops Astro's form-post exemption from mattering), 400 `bad-json` when the
 * body does not parse. `allowEmpty` (check scripts) accepts a completely empty body, whatever its
 * content type, as `value: undefined`.
 */
export async function readJson(
  request: Request,
  url: URL,
  options: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return { ok: false, response: forbidden };

  const isJson = JSON_CONTENT_TYPE.test(request.headers.get('content-type') ?? '');
  let text: string;
  try {
    text = await request.text();
  } catch (error) {
    return {
      ok: false,
      response: apiError(
        400,
        'bad-json',
        `could not read the request body: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }

  if (options.allowEmpty === true && text.trim() === '') return { ok: true, value: undefined };
  if (!isJson) {
    return {
      ok: false,
      response: apiError(415, 'unsupported-media-type', 'send the body as application/json'),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      response: apiError(
        400,
        'bad-json',
        `request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
}

/**
 * The slice of `ContextIoError` / `RecipeIoError` / `ReferenceIoError` / `SnippetIoError` the shared mapper
 * reads (same shape).
 */
interface IoErrorLike {
  code:
    | 'not-found'
    | 'exists'
    | 'invalid'
    | 'bad-slug'
    | 'name-mismatch'
    | 'parse'
    | 'invalid-file';
  message: string;
  issues: Issue[];
}

/**
 * Maps a context-io / recipe-io / reference-io failure to its API response (PLAN §G). `read` (GET): a file
 * that exists but fails parsing/schema is 422 `invalid-file`; `write` (POST/PUT): schema problems are 400
 * `invalid`.
 */
function ioErrorResponse(error: IoErrorLike, mode: 'read' | 'write'): Response {
  const issues = error.issues.length > 0 ? error.issues : undefined;
  switch (error.code) {
    case 'bad-slug':
      return apiError(400, 'bad-slug', error.message);
    case 'not-found':
      return apiError(404, 'not-found', error.message);
    case 'exists':
      return apiError(409, 'exists', error.message);
    case 'name-mismatch':
      return apiError(400, 'name-mismatch', error.message, issues);
    case 'invalid-file':
      return apiError(422, 'invalid-file', error.message, issues);
    case 'invalid':
    case 'parse':
      return mode === 'read'
        ? apiError(422, 'invalid-file', error.message, issues)
        : apiError(400, 'invalid', error.message, issues ?? []);
  }
}

/** Maps a context-io failure to its API response; anything that is not a `ContextIoError` is a 500. */
export function contextErrorResponse(error: unknown, mode: 'read' | 'write'): Response {
  if (!(error instanceof ContextIoError)) return internalError(error);
  return ioErrorResponse(error, mode);
}

/** Maps a recipe-io failure to its API response (same table as contexts); anything else is a 500. */
export function recipeErrorResponse(error: unknown, mode: 'read' | 'write'): Response {
  if (!(error instanceof RecipeIoError)) return internalError(error);
  return ioErrorResponse(error, mode);
}

/** Maps a reference-io failure to its API response (same table as contexts); anything else is a 500. */
export function referenceErrorResponse(error: unknown, mode: 'read' | 'write'): Response {
  if (!(error instanceof ReferenceIoError)) return internalError(error);
  return ioErrorResponse(error, mode);
}

/** Maps a snippet-io failure to its API response (same table as contexts); anything else is a 500. */
export function snippetErrorResponse(error: unknown, mode: 'read' | 'write'): Response {
  if (!(error instanceof SnippetIoError)) return internalError(error);
  return ioErrorResponse(error, mode);
}

/**
 * Maps a doc-io failure to its API response (ROUND2_BACKEND_SPEC §A.4, ROUND3_SPEC §D.3): bad-dataset / bad-slug /
 * bad-path / invalid 400, not-found 404, conflict and exists 409 (conflict carries the CURRENT `lastModified`),
 * too-large 413, not-text 422; anything that is not a `DocIoError` is a 500.
 */
export function docErrorResponse(error: unknown): Response {
  if (!(error instanceof DocIoError)) return internalError(error);
  switch (error.code) {
    case 'bad-dataset':
    case 'bad-slug':
    case 'bad-path':
      return apiError(400, error.code, error.message);
    case 'invalid':
      return apiError(400, 'invalid', error.message, error.issues);
    case 'not-found':
      return apiError(404, 'not-found', error.message);
    case 'conflict':
      return json(
        { error: 'conflict', message: error.message, lastModified: error.lastModified },
        409,
      );
    case 'exists':
      return apiError(409, 'exists', error.message);
    case 'too-large':
      return apiError(413, 'too-large', error.message);
    case 'not-text':
      return apiError(422, 'not-text', error.message);
  }
}

/**
 * Maps an agent history failure to its API response (concepts/agent-history.md): bad-agent / bad-key / invalid 400,
 * not-found 404, too-large 413; a DocIoError of the import's write goes through `docErrorResponse` (bad-dataset /
 * bad-slug / bad-path 400, not-found 404, exists 409); anything else is a 500.
 */
export function agentErrorResponse(error: unknown): Response {
  if (error instanceof DocIoError) return docErrorResponse(error);
  if (!(error instanceof AgentHistoryError)) return internalError(error);
  switch (error.code) {
    case 'bad-agent':
    case 'bad-key':
      return apiError(400, error.code, error.message);
    case 'invalid':
      return apiError(400, 'invalid', error.message, error.issues);
    case 'not-found':
      return apiError(404, 'not-found', error.message);
    case 'too-large':
      return apiError(413, 'too-large', error.message);
  }
}

/**
 * Maps an entry-io failure to its API response (ROUND3_SPEC §D.1, §D.2): bad-dataset / bad-slug 400, invalid 400
 * (issues), not-found 404, conflict 409 (body carries the CURRENT `lastModified`), exists 409, invalid-file 422
 * (issues); anything that is not an `EntryIoError` (an `EntryCreateError` of a failed template self-check, an IO
 * error) is a 500.
 */
export function entryErrorResponse(error: unknown): Response {
  if (!(error instanceof EntryIoError)) return internalError(error);
  const issues = error.issues.length > 0 ? error.issues : undefined;
  switch (error.code) {
    case 'bad-dataset':
    case 'bad-slug':
      return apiError(400, error.code, error.message);
    case 'invalid':
      return apiError(400, 'invalid', error.message, error.issues);
    case 'not-found':
      return apiError(404, 'not-found', error.message);
    case 'conflict':
      return json(
        { error: 'conflict', message: error.message, lastModified: error.lastModified },
        409,
      );
    case 'exists':
      return apiError(409, 'exists', error.message);
    case 'invalid-file':
      return apiError(422, 'invalid-file', error.message, issues ?? []);
  }
}
