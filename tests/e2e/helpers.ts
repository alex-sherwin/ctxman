// Shared helpers for the Playwright specs (PLAN §J.2, UI_SPEC §L). Node + Playwright only: no app imports.
import { existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import { parse } from 'yaml';
import { expect } from './fixtures.ts';
import { E2E_DATA_DIR, STEP_DELAY_HEADER } from './paths.ts';

export { E2E_DATA_DIR };

/** Path prefix for `request` calls; the per-worker baseURL (fixtures.ts) is prepended by Playwright. */
export const API = '/api';

/** Modifier for shortcuts: Cmd on macOS, Ctrl elsewhere (the app checks both). */
export const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Absolute path of a file inside the e2e data copy (`rel` is data-dir relative, e.g. `context/x.yaml`). */
export function dataPath(rel: string): string {
  return path.join(E2E_DATA_DIR, rel);
}

export function dataExists(rel: string): boolean {
  return existsSync(dataPath(rel));
}

export function readDataText(rel: string): string {
  return readFileSync(dataPath(rel), 'utf8');
}

export function readYaml(rel: string): unknown {
  return parse(readDataText(rel));
}

/** Opens the global search through the header button and waits for its input to take focus. */
export async function openSearch(page: Page): Promise<void> {
  await page.getByTestId('search-button').click();
  await expect(page.getByTestId('search-input')).toBeFocused();
}

/**
 * Appends `text` at the end of the Monaco editor under `testId`, typing it key by key through its hidden textarea
 * (UI_SPEC §L). Single-line or indentation-free text only: Monaco auto-indents typed newlines. Use
 * `pasteIntoMonaco` for multi-line text. Do not rely on Ctrl+A to replace content after a paste (see its comment).
 */
export async function typeIntoMonaco(page: Page, testId: string, text: string): Promise<void> {
  await focusMonacoEnd(page, testId);
  await page.keyboard.type(text);
}

/**
 * Appends `text` at the end of the Monaco editor under `testId` by dispatching a paste event that carries it, so
 * Monaco inserts multi-line text verbatim (typed newlines would be auto-indented). The event is synthetic, so the
 * hidden textarea does not mirror the model afterwards: later edits should use keys (End, Backspace), not Ctrl+A.
 */
export async function pasteIntoMonaco(page: Page, testId: string, text: string): Promise<void> {
  await focusMonacoEnd(page, testId);
  await page
    .getByTestId(testId)
    .locator('.monaco-editor textarea')
    .evaluate((el, value) => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
}

async function focusMonacoEnd(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).locator('.monaco-editor textarea').focus();
  await page.keyboard.press('ControlOrMeta+End');
}

/**
 * The visible chip of a list-page filter. Its checkbox/radio input is visually hidden (`ck-sr-only`) and the
 * label's text sits on top of it, so clicks must target the label (`chipOf(...).click()`); the input carries
 * the test id, and `toBeChecked()` works on it.
 */
export function chipOf(page: Page, inputTestId: string): Locator {
  return page.locator('label.ck-chip', { has: page.getByTestId(inputTestId) });
}

/**
 * Resolves on the next full page load. The page reloads itself ~150 ms after a write (Tools "add entry"
 * writes one): start listening BEFORE the write, await it AFTER the write's result is visible, and only then
 * interact with the page again.
 */
export function nextPageLoad(page: Page): Promise<void> {
  return page.waitForEvent('load', { timeout: 10_000 }).then(() => undefined);
}

/** A name no other test uses (a worker's data copy is shared by every test that worker runs). */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The shipped recipe (tests/data/recipe/ctxman-dev-brief.yaml). Read-only in the suite: tests copy it first. */
export const SEED_RECIPE = 'ctxman-dev-brief';

/** A recipe body as the API returns and accepts it (only the fields the suite reads are typed). */
export type RecipeBody = Record<string, unknown> & { name: string };

/** GET the seed recipe body. */
export async function fetchSeedRecipe(request: APIRequestContext): Promise<RecipeBody> {
  const response = await request.get(`${API}/recipe/${SEED_RECIPE}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { recipe: RecipeBody }).recipe;
}

/** Creates recipe `name` as a copy of the seed through `POST /api/recipe` (the seed file is never written). */
export async function createRecipeCopy(request: APIRequestContext, name: string): Promise<void> {
  const seed = await fetchSeedRecipe(request);
  const response = await request.post(`${API}/recipe`, { data: { ...seed, name } });
  expect(response.status()).toBe(201);
}

/** Removes a recipe through the API; 404 (already gone) is fine. */
export async function deleteRecipeQuietly(request: APIRequestContext, name: string): Promise<void> {
  await request.delete(`${API}/recipe/${name}`);
}

/**
 * Removes okf / skill entries (`'task/e2e-x'` keys) through `DELETE /api/entry/<ds>/<slug>`; 404 (already gone) is
 * fine. Cleanup of an entry goes through the server, never `rmSync` alone: the server memoizes its entry index for
 * 200 ms (src/lib/entry-index.ts) and only a write route drops that memo, so a folder removed behind its back is
 * still listed to the next test of the worker that asks within 200 ms (list-table.spec.ts saw a leftover `e2e-*`
 * task sorted before the seed tasks).
 */
export async function deleteEntries(
  request: APIRequestContext,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    const response = await request.delete(`${API}/entry/${key}`);
    expect([204, 404]).toContain(response.status());
  }
}

/** The saved YAML of recipe `name` (`recipe/<name>.yaml` in the data copy). */
export function readRecipeYaml(name: string): RecipeBody {
  return readYaml(`recipe/${name}.yaml`) as RecipeBody;
}

/** The next response to `method` whose pathname starts with `pathPrefix`. Create it BEFORE the action that sends it. */
export function waitForApi(page: Page, method: string, pathPrefix: string): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname.startsWith(pathPrefix),
  );
}

/** Runs `action` and returns the API response it caused (listener first: no race). The file is on disk once it resolves. */
export async function afterApi(
  page: Page,
  method: string,
  pathPrefix: string,
  action: () => Promise<void>,
): Promise<Response> {
  const response = waitForApi(page, method, pathPrefix);
  await action();
  return response;
}

/** Runs `action` (a save, a state change, a create) and resolves after the page has loaded again (it reloads itself). */
export async function afterReload(page: Page, action: () => Promise<unknown>): Promise<void> {
  const loaded = page.waitForEvent('load');
  await action();
  await loaded;
}

/** Moves a data file's mtime `ms` past its current one, so a conflict check sees a change without sleeping. */
export function bumpMtime(rel: string, ms = 2000): void {
  const file = dataPath(rel);
  const t = new Date(statSync(file).mtimeMs + ms);
  utimesSync(file, t, t);
}

/** A latch for `page.route`: hold a request until the test has seen the in-between state, then `open()`. */
export function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

/** Polls Node-side state that has no event (an Inflate job, the fake IDE record) every 25 ms; returns the last value. */
export async function pollUntil<T>(
  read: () => Promise<T> | T,
  done: (v: T) => boolean,
  timeout = 15_000,
): Promise<T> {
  let last!: T;
  await expect
    .poll(async () => done((last = await read())), { intervals: [25], timeout })
    .toBe(true);
  return last;
}

/** Waits (every animation frame, in the page) until the `attr` values of `selector` equal `expected`, in order. */
export async function expectOrder(
  page: Page,
  selector: string,
  attr: string,
  expected: string[],
): Promise<void> {
  const read = (): Promise<string[]> =>
    page.$$eval(selector, (els, a) => els.map((e) => e.getAttribute(a) ?? ''), attr);
  try {
    await page.waitForFunction(
      ([sel, a, want]) =>
        JSON.stringify([...document.querySelectorAll(sel)].map((e) => e.getAttribute(a) ?? '')) ===
        JSON.stringify(want),
      [selector, attr, expected] as const,
      { timeout: 5_000 },
    );
  } catch {
    expect(await read()).toEqual(expected); // readable failure
  }
}

/** Gives every Inflate run started from `page` a per-step delay (the server honours it under CTXMAN_TEST_HOOKS=1). */
export async function slowInflateSteps(page: Page, ms: number): Promise<void> {
  await page.route('**/api/inflate/run', (route) =>
    route.continue({ headers: { ...route.request().headers(), [STEP_DELAY_HEADER]: String(ms) } }),
  );
}
