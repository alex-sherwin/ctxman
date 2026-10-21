// Agent history import (plans/AGENT_HISTORY_SPEC.md, concepts/agent-history.md): the `+ Session` and `+ Plan` buttons
// of the Files panel, the two dialogs (list, filters, search, preview, keyboard), the import into an okf bundle and
// the API edges. Every worker's server reads its own fake agent home (tests/fixtures/agent-home.ts via
// CTXMAN_AGENT_HOME), never the real one. Each worker makes ONE e2e-* kb entry in beforeAll (its data copy is private)
// and every test imports to its own unique path, so the tests are independent and may run in any worker; the entry is
// removed in afterAll. Waits are events: a response promise created before the action, `afterReload` for the page the
// import opens, web-first assertions for everything else.
import { expect, test } from './fixtures.ts';
import type { Locator, Page, Response } from '@playwright/test';
import { parse } from 'yaml';
import {
  AGENT_HOME_NEWEST_SESSION,
  AGENT_HOME_PLANS,
  AGENT_HOME_PLAN_WORD,
  AGENT_HOME_SESSIONS,
  AGENT_HOME_SESSION_WORD,
  AGENT_HOME_UNLISTED_KEYS,
} from '../fixtures/agent-home.ts';
import {
  API,
  afterReload,
  dataExists,
  expectOrder,
  openSearch,
  readDataText,
  uniqueName,
  waitForApi,
} from './helpers.ts';

const kb = uniqueName('e2e-agent-kb');
const kbTitle = 'E2E agent import kb';
const bundleDir = `kb/${kb}`;

const NEWEST = AGENT_HOME_NEWEST_SESSION;
const SESSION_KEYS = AGENT_HOME_SESSIONS.map((s) => s.key);
const PLAN_KEYS = AGENT_HOME_PLANS.map((p) => p.key);
const ROLLOUT_PLAN = AGENT_HOME_PLANS[0]!; // the newest plan: the only one whose text has AGENT_HOME_PLAN_WORD
const ROW = '[data-testid="session-row"]';
const PLAN_ROW = '[data-testid="plan-row"]';

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    const created = await request.post(`${API}/entry/kb`, {
      data: { name: kb, title: kbTitle, description: 'Entry of the agent import spec.' },
    });
    expect(created.status()).toBe(201);
  } finally {
    await request.dispose();
  }
});

test.afterAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    await request.delete(`${API}/entry/kb/${kb}`);
  } finally {
    await request.dispose();
  }
});

// ---------------------------------------------------------------- helpers

/** A bundle path no other test uses. */
const uniquePath = (folder: string): string => `${folder}/${uniqueName('e2e')}.md`;

/** The doc page URL of a bundle file. */
const docUrl = (rel: string): string => `/kb/${kb}/doc/${rel.replace(/\.md$/, '')}`;

/** Frontmatter (parsed) and the rest of one bundle file in the worker's data copy. */
function readConcept(rel: string): { fm: Record<string, unknown>; body: string; text: string } {
  const text = readDataText(`${bundleDir}/${rel}`);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(match, `${rel} starts with frontmatter`).not.toBeNull();
  return {
    fm: parse(match![1]!) as Record<string, unknown>,
    body: text.slice(match![0].length),
    text,
  };
}

/** Opens `url`, waits for the island to enable the Files panel button, opens its dialog and waits for it. */
async function openDialog(
  page: Page,
  url: string,
  button: 'files-import-session' | 'files-import-plan',
): Promise<void> {
  await page.goto(url);
  const trigger = page.getByTestId(button);
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(
    page.getByTestId(button === 'files-import-session' ? 'session-dialog' : 'plan-dialog'),
  ).toBeVisible();
}

/** The session dialog with its list loaded (every fixture session listed) and the first row previewed. */
async function openSessions(page: Page, url = `/kb/${kb}`): Promise<void> {
  await openDialog(page, url, 'files-import-session');
  await expect(page.locator(ROW)).toHaveCount(SESSION_KEYS.length);
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');
}

/** The plan dialog with its list loaded and the first row previewed. */
async function openPlans(page: Page, url = `/kb/${kb}`): Promise<void> {
  await openDialog(page, url, 'files-import-plan');
  await expect(page.locator(PLAN_ROW)).toHaveCount(PLAN_KEYS.length);
  await expect(page.getByTestId('plan-preview')).toHaveAttribute('data-state', 'ready');
}

type ListKind = 'sessions' | 'plans';

/** The next list response (not a detail) of the dialog whose query satisfies `match`. Create it BEFORE the action. */
function listResponse(
  page: Page,
  kind: ListKind,
  match: (params: URLSearchParams) => boolean,
): Promise<Response> {
  return page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      r.request().method() === 'GET' &&
      url.pathname === `/api/agent-${kind}` &&
      match(url.searchParams)
    );
  });
}

/** The next detail response of the dialog whose query satisfies `match`. Create it BEFORE the action. */
function detailResponse(
  page: Page,
  kind: ListKind,
  match: (params: URLSearchParams) => boolean,
): Promise<Response> {
  return page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      r.request().method() === 'GET' &&
      url.pathname.startsWith(`/api/agent-${kind}/`) &&
      match(url.searchParams)
    );
  });
}

const importBody = (key: string, path: string, extra: Record<string, unknown> = {}) => ({
  key,
  dataset: 'kb',
  slug: kb,
  path,
  ...extra,
});

/** The Links line the import adds to the entry index.md: the title only (the entry index.md is searchable). */
function expectLinksLine(path: string, title: string): void {
  const index = readDataText(`${bundleDir}/index.md`);
  expect(index).toContain('## Links');
  expect(index.slice(index.indexOf('## Links'))).toContain(`* [${title}](/${path}) - ${title}\n`);
}

const previewBody = (page: Page, prefix: 'session' | 'plan'): Locator =>
  page.getByTestId(`${prefix}-preview-body`);

// ---------------------------------------------------------------- the Files panel

test('the Files panel offers + Session and + Plan on the entry page and on a doc page of the bundle', async ({
  page,
  request,
}) => {
  const concept = uniquePath('concepts');
  const created = await request.post(`${API}/doc/kb/${kb}/${concept}`, {
    data: { title: 'E2E agent concept' },
  });
  expect(created.status()).toBe(201);

  for (const url of [`/kb/${kb}`, docUrl(concept)]) {
    await page.goto(url);
    const files = page.getByTestId('detail-files');
    await expect(files.getByTestId('files-add-file')).toBeEnabled();
    await expect(files.getByTestId('files-import-session')).toBeEnabled();
    await expect(files.getByTestId('files-import-plan')).toBeEnabled();
    await expect(files.getByTestId('files-import-session')).toHaveText('+ Session');
    await expect(files.getByTestId('files-import-plan')).toHaveText('+ Plan');
  }

  // each button opens its own dialog; Esc closes it
  await page.getByTestId('files-import-plan').click();
  await expect(page.getByTestId('plan-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plan-dialog')).toBeHidden();
  await page.getByTestId('files-import-session').click();
  await expect(page.getByTestId('session-dialog')).toBeVisible();
  await page.getByTestId('session-import-cancel').click();
  await expect(page.getByTestId('session-dialog')).toBeHidden();
});

// ---------------------------------------------------------------- the session dialog

test('the session list is newest first, hides unlisted sessions and previews the first row', async ({
  page,
}) => {
  await openSessions(page);
  await expectOrder(page, ROW, 'data-key', SESSION_KEYS);
  for (const key of AGENT_HOME_UNLISTED_KEYS) {
    await expect(page.locator(`${ROW}[data-key="${key}"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId('session-count')).toHaveText(`${SESSION_KEYS.length} sessions`);

  const first = page.locator(ROW).first();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toContainText(NEWEST.title);
  await expect(page.locator(`${ROW}[aria-selected="true"]`)).toHaveCount(1);

  // the preview shows the markdown an import writes: the title as its H1, the meta line, the prefilled form
  const body = previewBody(page, 'session');
  await expect(body.getByRole('heading', { level: 1 })).toHaveText(NEWEST.title);
  await expect(page.getByTestId('session-meta').locator('[data-meta="agent"]')).toContainText(
    'Claude Code',
  );
  await expect(page.getByTestId('session-meta').locator('[data-meta="prompts"] dd')).toHaveText(
    String(NEWEST.prompts),
  );
  await expect(page.getByTestId('session-import-title')).toHaveValue(NEWEST.title);
  await expect(page.getByTestId('session-import-path')).toHaveValue(
    /^sessions\/\d{4}-\d{2}-\d{2}-claude-code-untangle-the-zebra-login-redirect\.md$/,
  );
  await expect(page.getByTestId('session-import-submit')).toBeEnabled();
});

test('the preview is inert: no script element, the tag as literal text, the relative link neutralized', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openSessions(page);
  const body = previewBody(page, 'session');
  await expect(body.getByRole('heading', { level: 1 })).toHaveText(NEWEST.title);

  await expect(body.locator('script')).toHaveCount(0);
  await expect(body).toContainText('<script>alert(1)</script>');
  // `[guide](docs/guide.md)` is a relative link the bundle checker would validate: it is text, not a link
  await expect(body.locator('a[href="docs/guide.md"]')).toHaveCount(0);
  await expect(body.locator('a[href$="guide.md"]')).toHaveCount(0);
  await expect(body).toContainText('guide');
  await expect(body).toContainText('docs/guide.md');
  // the whole dialog has no script of its own content either
  await expect(page.getByTestId('session-dialog').locator('script')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('the agent chips filter the list on the server', async ({ page }) => {
  await openSessions(page);
  const codex = AGENT_HOME_SESSIONS.filter((s) => s.agent === 'codex');
  const copilot = AGENT_HOME_SESSIONS.filter((s) => s.agent === 'copilot');

  let response = listResponse(page, 'sessions', (p) => p.get('agent') === 'codex');
  await page.getByTestId('session-agent-codex').click();
  await response;
  await expectOrder(
    page,
    ROW,
    'data-key',
    codex.map((s) => s.key),
  );
  await expect(page.getByTestId('session-count')).toHaveText(`${codex.length} sessions`);
  await expect(page.locator(`${ROW}[data-agent="codex"]`)).toHaveCount(codex.length);
  // the first row of the filtered list is the selected one and is previewed
  await expect(page.locator(ROW).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('session-import-title')).toHaveValue(codex[0]!.title);
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');
  // the archived Codex session is a Codex session with its own badge
  await expect(page.locator(`${ROW}[data-source="codex-archived"]`)).toContainText('archived');

  response = listResponse(page, 'sessions', (p) => p.get('agent') === 'copilot');
  await page.getByTestId('session-agent-copilot').click();
  await response;
  await expectOrder(
    page,
    ROW,
    'data-key',
    copilot.map((s) => s.key),
  );
  await expect(page.locator(`${ROW}[data-source="vscode"]`)).not.toHaveCount(0);
  await expect(page.locator(`${ROW}[data-source="copilot-cli"]`)).toHaveCount(1);

  response = listResponse(page, 'sessions', (p) => p.get('agent') === 'claude-code');
  await page.getByTestId('session-agent-claude-code').click();
  await response;
  await expectOrder(
    page,
    ROW,
    'data-key',
    AGENT_HOME_SESSIONS.filter((s) => s.agent === 'claude-code').map((s) => s.key),
  );

  response = listResponse(page, 'sessions', (p) => !p.has('agent'));
  await page.getByTestId('session-agent-all').click();
  await response;
  await expectOrder(page, ROW, 'data-key', SESSION_KEYS);
});

test('the search narrows the list on the server (title, prompt, directory; not the response text)', async ({
  page,
}) => {
  await openSessions(page);
  const search = page.getByTestId('session-search');
  await expect(search).toBeFocused();

  let response = listResponse(page, 'sessions', (p) => p.get('q') === 'webhook');
  await search.fill('webhook');
  await response;
  const webhook = AGENT_HOME_SESSIONS.find((s) => s.title.includes('webhook'))!;
  await expectOrder(page, ROW, 'data-key', [webhook.key]);
  await expect(page.getByTestId('session-count')).toHaveText('1 session');
  await expect(page.locator(ROW).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('session-import-title')).toHaveValue(webhook.title);

  // every whitespace token must match; the title word of another session
  response = listResponse(page, 'sessions', (p) => p.get('q') === 'zebra login');
  await search.fill('zebra login');
  await response;
  await expectOrder(page, ROW, 'data-key', [NEWEST.key]);

  // a word that is only in a response (the body) is not searched: the empty state says where ctxman looked
  response = listResponse(page, 'sessions', (p) => p.get('q') === AGENT_HOME_SESSION_WORD);
  await search.fill(AGENT_HOME_SESSION_WORD);
  await response;
  const empty = page.getByTestId('session-empty');
  await expect(empty).toBeVisible();
  await expect(page.locator(ROW)).toHaveCount(0);
  await expect(empty.getByTestId('session-empty-source').first()).toBeVisible();
  await expect(
    empty.locator('[data-testid="session-empty-source"][data-source="claude-code"]'),
  ).toHaveAttribute('data-exists', 'true');
  await expect(
    empty.locator('[data-testid="session-empty-source"][data-source="vscode-insiders"]'),
  ).toHaveAttribute('data-exists', 'false');

  // clearing the search brings the whole list back
  response = listResponse(page, 'sessions', (p) => !p.has('q'));
  await search.fill('');
  await response;
  await expectOrder(page, ROW, 'data-key', SESSION_KEYS);
});

test('Tool calls and Thinking refetch the preview and change it', async ({ page }) => {
  await openSessions(page);
  const body = previewBody(page, 'session');
  const tools = page.getByTestId('session-opt-tools');
  const thinking = page.getByTestId('session-opt-thinking');
  await expect(tools.getByRole('checkbox')).toBeChecked();
  await expect(thinking.getByRole('checkbox')).not.toBeChecked();
  await expect(body).toContainText('git status');
  await expect(body).toContainText('src/lib/auth.ts');
  await expect(body).not.toContainText('redirect guard probably runs twice');

  let response = detailResponse(page, 'sessions', (p) => p.get('tools') === '0');
  await tools.click();
  expect((await response).status()).toBe(200);
  await expect(tools.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');
  await expect(body).not.toContainText('git status');
  await expect(body).not.toContainText('src/lib/auth.ts');
  await expect(body).toContainText('The redirect comes from');

  response = detailResponse(
    page,
    'sessions',
    (p) => p.get('tools') === '0' && p.get('thinking') === '1',
  );
  await thinking.click();
  expect((await response).status()).toBe(200);
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');
  await expect(body).toContainText('redirect guard probably runs twice');
  await expect(body.locator('blockquote')).toContainText('Thinking');

  response = detailResponse(
    page,
    'sessions',
    (p) => p.get('tools') === '1' && p.get('thinking') === '1',
  );
  await tools.click();
  await response;
  await expect(body).toContainText('git status');
  await expect(body).toContainText('redirect guard probably runs twice');
});

test('ArrowDown / ArrowUp in the search field and in the list move the selection and the preview', async ({
  page,
}) => {
  await openSessions(page);
  const rows = page.locator(ROW);
  await expect(page.getByTestId('session-search')).toBeFocused();
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');

  // from the search field: the caret does not move, the selection does
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false');
  const second = AGENT_HOME_SESSIONS[1]!;
  await expect(page.getByTestId('session-import-title')).toHaveValue(second.title);
  await expect(previewBody(page, 'session').getByRole('heading', { level: 1 })).toHaveText(
    second.title,
  );
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp'); // clamped to the first row
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`${ROW}[aria-selected="true"]`)).toHaveCount(1);

  // from the list itself: a click selects, the arrow keys move
  await rows.nth(3).click();
  await expect(rows.nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('session-import-title')).toHaveValue(AGENT_HOME_SESSIONS[3]!.title);
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(4)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('session-import-title')).toHaveValue(AGENT_HOME_SESSIONS[4]!.title);
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');
});

// ---------------------------------------------------------------- importing a session

test('importing a session writes an agent-session concept with index: false, links it from index.md and opens it', async ({
  page,
}) => {
  const path = uniquePath('imports');
  await openSessions(page);
  const pathInput = page.getByTestId('session-import-path');
  await expect(pathInput).toHaveValue(/^sessions\//);
  await pathInput.fill(path);
  await expect(page.getByTestId('session-import-submit')).toBeEnabled();

  const imported = waitForApi(page, 'POST', '/api/agent-sessions/import');
  await afterReload(page, () => page.getByTestId('session-import-submit').click());
  const response = await imported;
  expect(response.status()).toBe(201);
  expect(response.headers()['location']).toBe(docUrl(path));
  // (the page navigates away: the body is gone; the API tests below read the 201 body)

  // the new doc page
  await expect(page).toHaveURL(new RegExp(`${docUrl(path)}$`));
  await expect(page.getByTestId('detail-path')).toHaveText(path);
  await expect(page.getByTestId('detail-content').getByRole('heading', { level: 1 })).toHaveText(
    NEWEST.title,
  );
  await expect(page.getByTestId('detail-content')).toContainText('<script>alert(1)</script>');
  await expect(page.getByTestId('detail-content').locator('script')).toHaveCount(0);

  // the file
  const { fm, body } = readConcept(path);
  expect(fm).toMatchObject({
    type: 'agent-session',
    title: NEWEST.title,
    index: false,
    agent: 'claude-code',
    source: 'claude-code',
    prompts: NEWEST.prompts,
    cwd: NEWEST.cwd,
  });
  expect(fm.tags).toEqual(['agent-session', 'claude-code']);
  expect(String(fm.session_id)).toBe(NEWEST.key.split(':')[1]);
  expect(typeof fm.imported).toBe('string');
  expect(body).toContain(`# ${NEWEST.title}`);
  expect(body).toContain('## Prompt 1');
  expect(body).toContain('&lt;script>alert(1)&lt;/script>');
  expect(body).not.toContain('<script>');
  expect(body).toContain('git status'); // tool calls are on by default
  expect(body).not.toContain('redirect guard probably runs twice'); // thinking is off by default
  expect(body).not.toContain('](docs/guide.md)');

  // listed under `## Links` of the entry (title only: the entry index.md is searchable)
  expectLinksLine(path, NEWEST.title);
  expect(readDataText(`${bundleDir}/index.md`)).not.toContain('Claude Code session in');
  // the entry page lists the new file in its Files panel (inside its closed `imports` folder)
  await page.goto(`/kb/${kb}`);
  await expect(
    page.getByTestId('detail-files').locator(`a[href="${docUrl(path)}"]`),
  ).toBeAttached();
});

test('the import honours Tool calls, Thinking and an edited title', async ({ page }) => {
  const path = uniquePath('imports');
  const title = 'E2E custom session title';
  await openSessions(page);
  const tools = page.getByTestId('session-opt-tools');
  const thinking = page.getByTestId('session-opt-thinking');

  let response = detailResponse(page, 'sessions', (p) => p.get('tools') === '0');
  await tools.click();
  await response;
  response = detailResponse(
    page,
    'sessions',
    (p) => p.get('tools') === '0' && p.get('thinking') === '1',
  );
  await thinking.click();
  await response;
  await expect(page.getByTestId('session-preview')).toHaveAttribute('data-state', 'ready');
  await expect(previewBody(page, 'session')).toContainText('redirect guard probably runs twice');

  await page.getByTestId('session-import-path').fill(path);
  await page.getByTestId('session-import-title').fill(title);
  await afterReload(page, () => page.getByTestId('session-import-submit').click());

  const { fm, body } = readConcept(path);
  expect(fm.title).toBe(title);
  expect(fm.index).toBe(false);
  expect(body).toContain(`# ${title}`);
  expect(body).toContain('**Thinking:**');
  expect(body).toContain('redirect guard probably runs twice');
  expect(body).not.toContain('git status');
  expectLinksLine(path, title);
});

test('importing to a path that exists shows session-import-error and keeps the dialog open', async ({
  page,
  request,
}) => {
  const path = uniquePath('imports');
  const first = await request.post(`${API}/agent-sessions/import`, {
    data: importBody(NEWEST.key, path),
  });
  expect(first.status()).toBe(201);
  const before = readDataText(`${bundleDir}/${path}`);

  await openSessions(page);
  await page.getByTestId('session-import-path').fill(path);
  const attempt = waitForApi(page, 'POST', '/api/agent-sessions/import');
  await page.getByTestId('session-import-submit').click();
  expect((await attempt).status()).toBe(409);

  const error = page.getByTestId('session-import-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('already exists');
  await expect(error).toContainText(path);
  await expect(page.getByTestId('session-dialog')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/kb/${kb}$`));
  // the existing file is untouched and the form is usable again
  expect(readDataText(`${bundleDir}/${path}`)).toBe(before);
  await expect(page.getByTestId('session-import-submit')).toBeEnabled();

  // another path clears the message
  await page.getByTestId('session-import-path').fill(uniquePath('imports'));
  await expect(error).toBeHidden();
});

test('an invalid path or a blank title disables Import and says why', async ({ page }) => {
  await openSessions(page);
  const submit = page.getByTestId('session-import-submit');
  const pathInput = page.getByTestId('session-import-path');
  await expect(submit).toBeEnabled();

  const bad: [string, RegExp][] = [
    ['../escape.md', /\.\./],
    ['imports/./x.md', /\./],
    ['.hidden/x.md', /dot/],
    ['imports/a:b.md', /not allowed/],
    ['imports//x.md', /empty/],
    ['sessions/index.md', /reserved/],
    ['sessions/log.md', /reserved/],
  ];
  for (const [value, message] of bad) {
    await pathInput.fill(value);
    await expect(submit, value).toBeDisabled();
    await expect(
      page.getByTestId('session-dialog').getByText(message).first(),
      value,
    ).toBeVisible();
  }
  await pathInput.fill('');
  await expect(submit).toBeDisabled();

  await pathInput.fill(uniquePath('imports'));
  await expect(submit).toBeEnabled();
  await page.getByTestId('session-import-title').fill('   ');
  await expect(submit).toBeDisabled();
  await page.getByTestId('session-import-title').fill('A title');
  await expect(submit).toBeEnabled();
  // nothing was written by any of this
  expect(dataExists(`${bundleDir}/escape.md`)).toBe(false);
});

// ---------------------------------------------------------------- the plan dialog

test('the plan list is newest first, previews the first plan inertly and filters by agent', async ({
  page,
}) => {
  await openPlans(page);
  await expectOrder(page, PLAN_ROW, 'data-key', PLAN_KEYS);
  await expect(page.getByTestId('plan-count')).toHaveText(`${PLAN_KEYS.length} plans`);
  const first = page.locator(PLAN_ROW).first();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toContainText(ROLLOUT_PLAN.title);

  const body = previewBody(page, 'plan');
  await expect(body.getByRole('heading', { level: 1 })).toHaveText(ROLLOUT_PLAN.title);
  await expect(body).toContainText(AGENT_HOME_PLAN_WORD);
  // `<b>alerts</b>` is literal text and `./dash.md` a neutralized link
  await expect(body.locator('b')).toHaveCount(0);
  await expect(body).toContainText('<b>alerts</b>');
  await expect(body.locator('a[href="./dash.md"]')).toHaveCount(0);
  await expect(body).toContainText('./dash.md');
  await expect(page.getByTestId('plan-import-title')).toHaveValue(ROLLOUT_PLAN.title);
  await expect(page.getByTestId('plan-import-path')).toHaveValue(
    'plans/rollout-plan-for-the-new-feature-flag.md',
  );

  const codex = AGENT_HOME_PLANS.filter((p) => p.agent === 'codex');
  const response = listResponse(page, 'plans', (p) => p.get('agent') === 'codex');
  await page.getByTestId('plan-agent-codex').click();
  await response;
  await expectOrder(
    page,
    PLAN_ROW,
    'data-key',
    codex.map((p) => p.key),
  );
  await expect(page.locator(PLAN_ROW).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('plan-import-title')).toHaveValue(codex[0]!.title);
});

test('the plan search covers the whole text and the empty state lists the locations', async ({
  page,
}) => {
  await openPlans(page);
  const search = page.getByTestId('plan-search');
  await expect(search).toBeFocused();

  let response = listResponse(page, 'plans', (p) => p.get('q') === AGENT_HOME_PLAN_WORD);
  await search.fill(AGENT_HOME_PLAN_WORD);
  await response;
  await expectOrder(page, PLAN_ROW, 'data-key', [ROLLOUT_PLAN.key]); // the word is not in its title
  await expect(page.getByTestId('plan-count')).toHaveText('1 plan');
  await expect(page.locator(PLAN_ROW).first()).toHaveAttribute('aria-selected', 'true');

  response = listResponse(page, 'plans', (p) => p.get('q') === 'no-such-plan-text-anywhere');
  await search.fill('no-such-plan-text-anywhere');
  await response;
  await expect(page.getByTestId('plan-empty')).toBeVisible();
  await expect(
    page.getByTestId('plan-empty').getByTestId('plan-empty-source').first(),
  ).toBeVisible();

  response = listResponse(page, 'plans', (p) => !p.has('q'));
  await search.fill('');
  await response;
  await expectOrder(page, PLAN_ROW, 'data-key', PLAN_KEYS);
});

test('ArrowDown in the plan search field moves the selection', async ({ page }) => {
  await openPlans(page);
  await expect(page.getByTestId('plan-search')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(PLAN_ROW).nth(1)).toHaveAttribute('aria-selected', 'true');
  const second = AGENT_HOME_PLANS[1]!;
  await expect(page.getByTestId('plan-import-title')).toHaveValue(second.title);
  await expect(previewBody(page, 'plan').getByRole('heading', { level: 1 })).toHaveText(
    second.title,
  );
});

test('importing a plan writes a plan concept with index: false and opens it; a second import to the path is a 409', async ({
  page,
}) => {
  const path = uniquePath('plans');
  await openPlans(page);
  await page.getByTestId('plan-import-path').fill(path);
  await afterReload(page, () => page.getByTestId('plan-import-submit').click());

  await expect(page).toHaveURL(new RegExp(`${docUrl(path)}$`));
  await expect(page.getByTestId('detail-path')).toHaveText(path);
  await expect(page.getByTestId('detail-content').getByRole('heading', { level: 1 })).toHaveText(
    ROLLOUT_PLAN.title,
  );
  const { fm, body } = readConcept(path);
  expect(fm).toMatchObject({
    type: 'plan',
    title: ROLLOUT_PLAN.title,
    index: false,
    agent: 'claude-code',
    source: 'claude-code',
    plan_id: 'zesty-rollout',
  });
  expect(fm.tags).toEqual(['plan', 'claude-code']);
  expect(body).toContain(AGENT_HOME_PLAN_WORD);
  expect(body).toContain('&lt;b>alerts&lt;/b>');
  expect(body).not.toContain('](./dash.md)');
  expectLinksLine(path, ROLLOUT_PLAN.title);

  // the same path again: 409, the dialog stays and says so
  await openPlans(page);
  await page.getByTestId('plan-import-path').fill(path);
  const attempt = waitForApi(page, 'POST', '/api/agent-plans/import');
  await page.getByTestId('plan-import-submit').click();
  expect((await attempt).status()).toBe(409);
  await expect(page.getByTestId('plan-import-error')).toContainText('already exists');
  await expect(page.getByTestId('plan-dialog')).toBeVisible();
});

// ---------------------------------------------------------------- search exclusion

test('imported sessions and plans stay out of the search index and the search widget; the entry is found', async ({
  page,
  request,
}) => {
  const sessionPath = uniquePath('imports');
  const planPath = uniquePath('plans');
  expect(
    (
      await request.post(`${API}/agent-sessions/import`, {
        data: importBody(NEWEST.key, sessionPath),
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await request.post(`${API}/agent-plans/import`, {
        data: importBody(ROLLOUT_PLAN.key, planPath),
      })
    ).status(),
  ).toBe(201);
  // the text really is in the files (so the exclusion is `index: false`, not a missing word)
  expect(readConcept(sessionPath).body).toContain(AGENT_HOME_SESSION_WORD);
  expect(readConcept(planPath).body).toContain(AGENT_HOME_PLAN_WORD);

  // the index API
  const response = await request.get(`${API}/search-index.json`);
  expect(response.status()).toBe(200);
  const { docs } = (await response.json()) as {
    docs: { id: string; url: string; body: string; title?: string }[];
  };
  const ids = docs.map((d) => d.id);
  expect(ids).toContain(`kb/${kb}`);
  expect(ids.filter((id) => id.includes(sessionPath.replace(/\.md$/, '')))).toEqual([]);
  expect(ids.filter((id) => id.includes(planPath.replace(/\.md$/, '')))).toEqual([]);
  expect(docs.filter((d) => d.url === docUrl(sessionPath) || d.url === docUrl(planPath))).toEqual(
    [],
  );
  for (const word of [AGENT_HOME_SESSION_WORD, AGENT_HOME_PLAN_WORD, 'alert(1)']) {
    expect(
      docs.filter((d) => d.body.includes(word)).map((d) => d.id),
      word,
    ).toEqual([]);
  }

  // the widget (it loads the index when it opens)
  await page.goto('/');
  await openSearch(page);
  const input = page.getByTestId('search-input');
  const entryHit = page.locator(`[data-testid="search-result"][href="/kb/${kb}"]`);
  await input.fill(kbTitle);
  await expect(entryHit).toBeVisible(); // the index is loaded and finds the entry
  for (const word of [AGENT_HOME_SESSION_WORD, AGENT_HOME_PLAN_WORD]) {
    await input.fill(word);
    await expect(page).toHaveURL(new RegExp(`[?&]sq=${word}(&|$)`));
    await expect(page.getByTestId('search-result')).toHaveCount(0);
  }
  // a title word finds at most the entry (its `## Links` line carries the title), never the imported file
  await input.fill('zebra');
  await expect(page).toHaveURL(/[?&]sq=zebra(&|$)/);
  await expect(
    page.locator(`[data-testid="search-result"][href="${docUrl(sessionPath)}"]`),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------- API edges

test.describe('API edges', () => {
  const unknownSession = 'claude-code:c1a0de00-0000-4000-8000-0000000000ff';
  const errorOf = async (response: { json(): Promise<unknown> }): Promise<{ error: string }> =>
    (await response.json()) as { error: string };

  test('GET /api/agent-sessions lists the fixture and answers 400 bad-agent', async ({
    request,
  }) => {
    const list = await request.get(`${API}/agent-sessions`);
    expect(list.status()).toBe(200);
    const body = (await list.json()) as { items: { key: string }[]; next: number | null };
    expect(body.items.map((s) => s.key)).toEqual(SESSION_KEYS);
    expect(body.next).toBeNull();

    const page = await request.get(`${API}/agent-sessions?limit=3`);
    const first = (await page.json()) as { items: { key: string }[]; next: number | null };
    expect(first.items.map((s) => s.key)).toEqual(SESSION_KEYS.slice(0, 3));
    expect(first.next).toBe(3);
    const rest = await request.get(`${API}/agent-sessions?limit=3&offset=3`);
    expect(((await rest.json()) as { items: { key: string }[] }).items.map((s) => s.key)).toEqual(
      SESSION_KEYS.slice(3, 6),
    );

    const bad = await request.get(`${API}/agent-sessions?agent=gemini`);
    expect(bad.status()).toBe(400);
    expect((await errorOf(bad)).error).toBe('bad-agent');
    expect((await request.get(`${API}/agent-plans?agent=gemini`)).status()).toBe(400);
  });

  test('a bad key is 400 bad-key, an unknown key 404 not-found, a good key the detail', async ({
    request,
  }) => {
    for (const bad of [
      'nokey',
      'bogus:abc',
      'claude-code:',
      encodeURIComponent('../../etc/passwd'),
    ]) {
      const sessions = await request.get(`${API}/agent-sessions/${bad}`);
      expect(sessions.status(), bad).toBe(400);
      expect((await errorOf(sessions)).error, bad).toBe('bad-key');
      const plans = await request.get(`${API}/agent-plans/${bad}`);
      expect(plans.status(), bad).toBe(400);
      expect((await errorOf(plans)).error, bad).toBe('bad-key');
    }

    const missing = await request.get(
      `${API}/agent-sessions/${encodeURIComponent(unknownSession)}`,
    );
    expect(missing.status()).toBe(404);
    expect((await errorOf(missing)).error).toBe('not-found');
    const missingPlan = await request.get(
      `${API}/agent-plans/${encodeURIComponent('claude-code:nope')}`,
    );
    expect(missingPlan.status()).toBe(404);
    const detail = await request.get(`${API}/agent-sessions/${encodeURIComponent(NEWEST.key)}`);
    expect(detail.status()).toBe(200);
    const body = (await detail.json()) as {
      summary: { key: string; title: string };
      prompts: number;
      markdown: string;
      html: string;
      defaultPath: string;
    };
    expect(body.summary).toMatchObject({ key: NEWEST.key, title: NEWEST.title });
    expect(body.prompts).toBe(NEWEST.prompts);
    expect(body.markdown).toMatch(/^---\ntype: agent-session\n/);
    expect(body.markdown).toContain('\nindex: false\n');
    expect(body.html).not.toContain('<script');
    expect(body.defaultPath).toMatch(/^sessions\/\d{4}-\d{2}-\d{2}-claude-code-untangle-the-zebra/);
    // tools=0 drops the tool calls
    const plain = await request.get(
      `${API}/agent-sessions/${encodeURIComponent(NEWEST.key)}?tools=0`,
    );
    expect(((await plain.json()) as { markdown: string }).markdown).not.toContain('git status');
    // the decoded key (with its colon) works too
    expect((await request.get(`${API}/agent-sessions/${NEWEST.key}`)).status()).toBe(200);

    const plan = await request.get(`${API}/agent-plans/${encodeURIComponent(ROLLOUT_PLAN.key)}`);
    expect(plan.status()).toBe(200);
    const planBody = (await plan.json()) as { markdown: string; defaultPath: string };
    expect(planBody.markdown).toMatch(/^---\ntype: plan\n/);
    expect(planBody.markdown).toContain('\nindex: false\n');
    expect(planBody.defaultPath).toBe('plans/rollout-plan-for-the-new-feature-flag.md');
  });

  test('an import with a foreign Origin is 403 and writes nothing', async ({
    request,
    baseURL,
  }) => {
    const path = uniquePath('imports');
    for (const url of ['agent-sessions/import', 'agent-plans/import']) {
      const key = url.startsWith('agent-sessions') ? NEWEST.key : ROLLOUT_PLAN.key;
      const response = await request.post(`${API}/${url}`, {
        data: importBody(key, path),
        headers: { origin: 'https://evil.example' },
      });
      expect(response.status(), url).toBe(403);
      expect((await errorOf(response)).error, url).toBe('forbidden-origin');
    }
    expect(dataExists(`${bundleDir}/${path}`)).toBe(false);
    // the server's own origin is accepted
    const ok = await request.post(`${API}/agent-sessions/import`, {
      data: importBody(NEWEST.key, path),
      headers: { origin: baseURL! },
    });
    expect(ok.status()).toBe(201);
  });

  test('a duplicate import is 409 exists and leaves the file; both routes', async ({ request }) => {
    const sessionPath = uniquePath('imports');
    const planPath = uniquePath('plans');
    const created = await request.post(`${API}/agent-sessions/import`, {
      data: importBody(NEWEST.key, sessionPath),
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as {
      path: string;
      url: string;
      lastModified: string;
      warnings: unknown[];
    };
    expect(body).toMatchObject({ path: sessionPath, url: docUrl(sessionPath) });
    expect(body.warnings).toEqual([]); // no links/* finding from the neutralized text
    expect(created.headers()['location']).toBe(docUrl(sessionPath));
    const before = readDataText(`${bundleDir}/${sessionPath}`);

    const again = await request.post(`${API}/agent-sessions/import`, {
      data: importBody(NEWEST.key, sessionPath, { title: 'Other title' }),
    });
    expect(again.status()).toBe(409);
    expect((await errorOf(again)).error).toBe('exists');
    expect(readDataText(`${bundleDir}/${sessionPath}`)).toBe(before);

    expect(
      (
        await request.post(`${API}/agent-plans/import`, {
          data: importBody(ROLLOUT_PLAN.key, planPath),
        })
      ).status(),
    ).toBe(201);
    const planAgain = await request.post(`${API}/agent-plans/import`, {
      data: importBody(ROLLOUT_PLAN.key, planPath),
    });
    expect(planAgain.status()).toBe(409);
    expect((await errorOf(planAgain)).error).toBe('exists');
    // a plan and a session cannot share one path either
    const crossed = await request.post(`${API}/agent-plans/import`, {
      data: importBody(ROLLOUT_PLAN.key, sessionPath),
    });
    expect(crossed.status()).toBe(409);
  });

  test('import validates the body, the key and the target', async ({ request }) => {
    const post = (data: unknown, url = 'agent-sessions/import') =>
      request.post(`${API}/${url}`, { data });
    const path = uniquePath('imports');

    const noKey = await post({ dataset: 'kb', slug: kb, path });
    expect(noKey.status()).toBe(400);
    expect((await errorOf(noKey)).error).toBe('invalid');

    const badKey = await post(importBody('nokey', path));
    expect(badKey.status()).toBe(400);
    expect((await errorOf(badKey)).error).toBe('bad-key');

    const unknown = await post(importBody(unknownSession, path));
    expect(unknown.status()).toBe(404);
    expect((await errorOf(unknown)).error).toBe('not-found');

    const noEntry = await post({ ...importBody(NEWEST.key, path), slug: 'e2e-no-such-entry' });
    expect(noEntry.status()).toBe(404);

    const badDataset = await post({ ...importBody(NEWEST.key, path), dataset: 'context' });
    expect(badDataset.status()).toBe(400);
    expect((await errorOf(badDataset)).error).toBe('bad-dataset');

    const badSlug = await post({ ...importBody(NEWEST.key, path), slug: 'Not A Slug' });
    expect(badSlug.status()).toBe(400);

    for (const bad of [
      '../escape.md',
      'imports/../../x.md',
      'index.md',
      'log.md',
      '.hidden/x.md',
    ]) {
      const response = await post(importBody(NEWEST.key, bad));
      expect(response.status(), bad).toBe(400);
      expect((await errorOf(response)).error, bad).toBe('bad-path');
    }

    const text = await request.post(`${API}/agent-sessions/import`, {
      headers: { 'content-type': 'text/plain' },
      data: 'x',
    });
    expect(text.status()).toBe(415);
    expect((await request.get(`${API}/agent-sessions/import`)).status()).toBe(405);
    expect((await request.get(`${API}/agent-plans/import`)).status()).toBe(405);
    expect(dataExists(`${bundleDir}/escape.md`)).toBe(false);
  });
});
