// Shared helpers for the Playwright specs (PLAN §J.2, UI_SPEC §L). Node + Playwright only: no app imports.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from './paths.ts';

export { E2E_DATA_DIR };

/** Path prefix for `request` calls; the baseURL from playwright.config.ts is prepended by Playwright. */
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
 * Resolves on the next full page load. The dev server reloads the page about 0.5 s after an okf, skill or
 * reference data write (Tools "add entry" writes one): start listening BEFORE the write, await it AFTER the
 * write's result is visible, and only then interact with the page again.
 */
export function nextPageLoad(page: Page): Promise<void> {
  return page.waitForEvent('load', { timeout: 10_000 }).then(() => undefined);
}

/** A name no other test uses (the data copy is shared by the whole run). */
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

/** The saved YAML of recipe `name` (`recipe/<name>.yaml` in the data copy). */
export function readRecipeYaml(name: string): RecipeBody {
  return readYaml(`recipe/${name}.yaml`) as RecipeBody;
}

/** @deprecated No file watcher reloads pages any more; kept as a no-op so the specs compile (removed in the cleanup phase). */
export function settleDevReload(_ms = 1500): Promise<void> {
  return Promise.resolve();
}
