// Entry write APIs (ROUND3_SPEC §D.1 to §D.5) over Playwright's request context:
//   GET|PATCH /api/entry/<ds>/<slug>, POST /api/entry/<ds>, POST /api/doc/<ds>/<slug>/<path> (create a concept)
//   and POST /api/context/<slug>/links. Every spec uses its own e2e-* entries (created through the API, removed in
//   afterAll); the seed entries are never written. The API reads and writes the files directly, so nothing waits for
//   the content layer.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { API, dataPath, readDataText, settleDevReload, uniqueName } from './helpers.ts';

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
  lastModified?: string;
}

interface EntryBody {
  frontmatter: Record<string, unknown>;
  lastModified: string;
  issues?: { path: string; message: string }[];
  changed?: boolean;
  warnings?: { rule: string; message: string }[];
}

const errorOf = async (response: APIResponse): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const project = uniqueName('e2e-ent-proj');
const task = uniqueName('e2e-ent-task');
const child = uniqueName('e2e-ent-child');
const ctx = uniqueName('e2e-ent-ctx');
const mainOf = (ds: string, slug: string): string => `${ds}/${slug}/index.md`;
const entryUrl = (ds: string, slug: string): string => `${API}/entry/${ds}/${slug}`;
const jsonHeaders = { 'content-type': 'application/json' };

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ playwright, baseURL }) => {
  for (const [ds, slug] of [
    ['task', task],
    ['task', child],
    ['project', project],
  ] as const) {
    rmSync(dataPath(`${ds}/${slug}`), { recursive: true, force: true });
  }
  const request = await playwright.request.newContext({ baseURL });
  try {
    await request.delete(`${API}/context/${ctx}`);
  } finally {
    await request.dispose();
  }
  await settleDevReload();
});

test('POST /api/entry creates the project and the task; GET returns JSON-safe frontmatter', async ({
  request,
}) => {
  const proj = await request.post(`${API}/entry/project`, {
    data: {
      name: project,
      title: 'E2E entry project',
      description: 'Project for the entry API spec.',
    },
  });
  expect(proj.status()).toBe(201);

  const response = await request.post(`${API}/entry/task`, {
    data: {
      name: task,
      title: 'E2E entry task',
      description: 'Task for the entry API spec.',
      state: 'in-progress',
      tags: ['E2E', 'entry api'],
    },
  });
  expect(response.status()).toBe(201);
  expect(response.headers().location).toBe(`/task/${task}`);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({
    dataset: 'task',
    slug: task,
    path: mainOf('task', task),
    url: `/task/${task}`,
    files: [mainOf('task', task), `task/${task}/log.md`],
  });

  const got = await request.get(entryUrl('task', task));
  expect(got.status()).toBe(200);
  expect(got.headers()['cache-control']).toBe('no-store');
  const body = (await got.json()) as EntryBody;
  expect(body.frontmatter).toMatchObject({
    type: 'Task',
    name: task,
    title: 'E2E entry task',
    state: 'in-progress',
    tags: ['e2e', 'entry-api'],
  });
  expect(typeof (body.frontmatter.generated as { at: unknown }).at).toBe('string');
  expect(Number.isNaN(Date.parse(body.lastModified))).toBe(false);
  expect(body.issues).toEqual([]);
});

test('PATCH state changes only the state line; the body and an unknown key stay byte for byte', async ({
  request,
}) => {
  // Hand-edit the file: an unknown flow-style key with odd spacing, a comment and body prose.
  const file = dataPath(mainOf('task', task));
  const created = readFileSync(file, 'utf8');
  const hand = created
    .replace('state: in-progress\n', 'state: in-progress  # keep me\n')
    .replace('\ngenerated:', '\nx-keep: {a: [1,   2],  b: "x"}\ngenerated:')
    .concat('\nHand-written prose.\n');
  writeFileSync(file, hand);

  const before = (await (await request.get(entryUrl('task', task))).json()) as EntryBody;
  const response = await request.patch(entryUrl('task', task), {
    data: { state: 'pending', ifUnmodifiedSince: before.lastModified },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as EntryBody;
  expect(body.changed).toBe(true);
  expect(body.frontmatter.state).toBe('pending');
  expect(body.frontmatter['x-keep']).toEqual({ a: [1, 2], b: 'x' });
  expect(body.warnings).toEqual([]);
  expect(Date.parse(body.lastModified)).toBeGreaterThanOrEqual(Date.parse(before.lastModified));

  // Only the state line differs (its trailing comment is dropped with the replaced value).
  expect(readFileSync(file, 'utf8')).toBe(
    hand.replace('state: in-progress  # keep me', 'state: pending'),
  );
});

test('PATCH with an invalid state is 400 invalid and the file is unchanged', async ({
  request,
}) => {
  const file = dataPath(mainOf('task', task));
  const before = readFileSync(file, 'utf8');
  const response = await request.patch(entryUrl('task', task), { data: { state: 'done' } });
  expect(response.status()).toBe(400);
  const body = await errorOf(response);
  expect(body.error).toBe('invalid');
  expect(body.issues?.[0]?.path).toBe('state');
  expect(readFileSync(file, 'utf8')).toBe(before);

  const unknown = await request.patch(entryUrl('task', task), { data: { priority: 1 } });
  expect(unknown.status()).toBe(400);
  expect((await errorOf(unknown)).issues).toEqual([
    { path: 'priority', message: 'unexpected property' },
  ]);

  const empty = await request.patch(entryUrl('task', task), { data: {} });
  expect(empty.status()).toBe(400);

  const badDate = await request.patch(entryUrl('task', task), {
    data: { stale_after: '2026-02-30' },
  });
  expect(badDate.status()).toBe(400);
  expect((await errorOf(badDate)).issues?.[0]?.path).toBe('stale_after');
  expect(readFileSync(file, 'utf8')).toBe(before);
});

test('PATCH title, description, tags and stale_after; null removes title and stale_after', async ({
  request,
}) => {
  const response = await request.patch(entryUrl('task', task), {
    data: {
      title: '  Patched\n title ',
      description: 'Patched description.',
      tags: ['Alpha', 'beta gamma', 'alpha'],
      stale_after: '2099-12-31',
    },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as EntryBody;
  expect(body.frontmatter).toMatchObject({
    title: 'Patched title',
    description: 'Patched description.',
    tags: ['alpha', 'beta-gamma'],
    stale_after: '2099-12-31',
  });
  const text = readDataText(mainOf('task', task));
  expect(text).toContain('\nstale_after: 2099-12-31\n');
  expect(text).toContain('\ntags: [alpha, beta-gamma]\n');

  const removed = await request.patch(entryUrl('task', task), {
    data: { title: null, stale_after: null },
  });
  expect(removed.status()).toBe(200);
  const after = ((await removed.json()) as EntryBody).frontmatter;
  expect(after).not.toHaveProperty('title');
  expect(after).not.toHaveProperty('stale_after');

  const same = await request.patch(entryUrl('task', task), {
    data: { tags: ['alpha', 'beta-gamma'] },
  });
  expect(((await same.json()) as EntryBody).changed).toBe(false);
});

test('a stale ifUnmodifiedSince is 409 conflict with the current lastModified', async ({
  request,
}) => {
  const first = (await (await request.get(entryUrl('task', task))).json()) as EntryBody;
  const saved = await request.patch(entryUrl('task', task), {
    data: { state: 'in-progress', ifUnmodifiedSince: first.lastModified },
  });
  expect(saved.status()).toBe(200);
  const current = ((await saved.json()) as EntryBody).lastModified;

  const stale = await request.patch(entryUrl('task', task), {
    data: { state: 'complete', ifUnmodifiedSince: first.lastModified },
  });
  expect(stale.status()).toBe(409);
  const body = await errorOf(stale);
  expect(body.error).toBe('conflict');
  expect(body.lastModified).toBe(current);
  expect(
    ((await (await request.get(entryUrl('task', task))).json()) as EntryBody).frontmatter.state,
  ).toBe('in-progress');
});

test('addLinks / removeLinks edit only the links key; a missing target is a warning', async ({
  request,
}) => {
  const file = dataPath(mainOf('task', task));
  const before = readFileSync(file, 'utf8');
  const added = await request.patch(entryUrl('task', task), {
    data: {
      addLinks: [
        { dataset: 'kb', slug: 'ctxman', rel: 'related' },
        { dataset: 'idea', slug: 'e2e-no-such-idea', rel: 'depends-on' },
      ],
    },
  });
  expect(added.status()).toBe(200);
  const body = (await added.json()) as EntryBody;
  expect(body.frontmatter.links).toEqual([
    { dataset: 'kb', slug: 'ctxman', rel: 'related' },
    { dataset: 'idea', slug: 'e2e-no-such-idea', rel: 'depends-on' },
  ]);
  expect(body.warnings?.map((w) => w.rule)).toEqual(['links/relation-target']);
  expect(readFileSync(file, 'utf8')).toContain(
    'links:\n  - dataset: kb\n    slug: ctxman\n    rel: related\n  - dataset: idea\n    slug: e2e-no-such-idea\n    rel: depends-on\n---',
  );

  const removed = await request.patch(entryUrl('task', task), {
    data: {
      removeLinks: [
        { dataset: 'kb', slug: 'ctxman' },
        { dataset: 'idea', slug: 'e2e-no-such-idea' },
      ],
    },
  });
  expect(removed.status()).toBe(200);
  expect(readFileSync(file, 'utf8')).toBe(before);

  const self = await request.patch(entryUrl('task', task), {
    data: { addLinks: [{ dataset: 'task', slug: task }] },
  });
  expect(self.status()).toBe(400);
  const mixed = await request.patch(entryUrl('task', task), {
    data: { links: [], addLinks: [{ dataset: 'kb', slug: 'ctxman' }] },
  });
  expect(mixed.status()).toBe(400);
});

test('PATCH / GET error statuses and 415 / 403 / 405', async ({ request }) => {
  expect((await request.get(entryUrl('task', 'e2e-no-such-entry'))).status()).toBe(404);
  const patch404 = await request.patch(entryUrl('task', 'e2e-no-such-entry'), {
    data: { state: 'pending' },
  });
  expect(patch404.status()).toBe(404);
  expect((await errorOf(patch404)).error).toBe('not-found');
  const dataset = await request.get(entryUrl('context', 'ctxman-dev'));
  expect(dataset.status()).toBe(400);
  expect((await errorOf(dataset)).error).toBe('bad-dataset');
  const slug = await request.get(entryUrl('task', 'Bad_Slug'));
  expect(slug.status()).toBe(400);
  expect((await errorOf(slug)).error).toBe('bad-slug');

  const media = await request.patch(entryUrl('task', task), {
    headers: { 'content-type': 'text/plain' },
    data: '{"state":"pending"}',
  });
  expect(media.status()).toBe(415);
  expect((await errorOf(media)).error).toBe('unsupported-media-type');
  const origin = await request.patch(entryUrl('task', task), {
    headers: { ...jsonHeaders, origin: 'http://evil.example' },
    data: { state: 'pending' },
  });
  expect(origin.status()).toBe(403);
  expect((await errorOf(origin)).error).toBe('forbidden-origin');
  const badJson = await request.patch(entryUrl('task', task), {
    headers: jsonHeaders,
    data: Buffer.from('{nope'),
  });
  expect(badJson.status()).toBe(400);
  expect((await errorOf(badJson)).error).toBe('bad-json');

  for (const method of ['put', 'delete'] as const) {
    const response = await request[method](entryUrl('task', task));
    expect(response.status(), method).toBe(405);
    expect(response.headers().allow).toBe('GET, PATCH');
  }
  const post = await request.get(`${API}/entry/task`);
  expect(post.status()).toBe(405);
  expect(post.headers().allow).toBe('POST');
});

test('POST /api/entry with a parent adds a child link to the project; the template stays valid', async ({
  request,
}) => {
  const projectFile = dataPath(mainOf('project', project));
  const before = readFileSync(projectFile, 'utf8');
  const response = await request.post(`${API}/entry/task`, {
    data: { name: child, description: 'Child task.', parent: project },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.parentLinked).toBe(true);
  expect(body).not.toHaveProperty('parentError');
  expect(readFileSync(projectFile, 'utf8')).toBe(
    before.replace(
      '\n---\n\n#',
      `\nlinks:\n  - dataset: task\n    slug: ${child}\n    rel: child\n---\n\n#`,
    ),
  );
  const proj = (await (await request.get(entryUrl('project', project))).json()) as EntryBody;
  expect(proj.frontmatter.links).toEqual([{ dataset: 'task', slug: child, rel: 'child' }]);
  expect(proj.issues).toEqual([]);
});

test('POST /api/entry validation: 409 exists, 400 invalid with field paths and nothing written', async ({
  request,
}) => {
  const exists = await request.post(`${API}/entry/task`, {
    data: { name: task, description: 'Again.' },
  });
  expect(exists.status()).toBe(409);
  expect((await errorOf(exists)).error).toBe('exists');

  const missingParent = uniqueName('e2e-ent-orphan');
  const bad = await request.post(`${API}/entry/task`, {
    data: { name: missingParent, description: 'Orphan.', parent: 'e2e-no-such-project' },
  });
  expect(bad.status()).toBe(400);
  expect((await errorOf(bad)).issues).toEqual([
    { path: 'parent', message: 'project "e2e-no-such-project" does not exist' },
  ]);
  expect(existsSync(dataPath(`task/${missingParent}`))).toBe(false);

  const fields = await request.post(`${API}/entry/kb`, {
    data: { name: 'Bad Name', description: '', state: 'pending', tags: ['no!'] },
  });
  expect(fields.status()).toBe(400);
  expect((await errorOf(fields)).issues?.map((i) => i.path).sort()).toEqual([
    'description',
    'name',
    'state',
    'tags.0',
  ]);

  const dataset = await request.post(`${API}/entry/reference`, {
    data: { name: 'x', description: 'd' },
  });
  expect(dataset.status()).toBe(400);
  expect((await errorOf(dataset)).error).toBe('bad-dataset');

  const media = await request.post(`${API}/entry/task`, {
    headers: { 'content-type': 'text/plain' },
    data: '{}',
  });
  expect(media.status()).toBe(415);
  const origin = await request.post(`${API}/entry/task`, {
    headers: { ...jsonHeaders, origin: 'http://evil.example' },
    data: {},
  });
  expect(origin.status()).toBe(403);
  expect((await request.put(`${API}/entry/task`, { data: {} })).status()).toBe(405);
});

test('POST /api/doc creates a concept, lists it in index.md and log.md and answers 409 the second time', async ({
  request,
}) => {
  const concept = 'concepts/e2e-entry-new.md';
  const url = `${API}/doc/task/${task}/${concept}`;
  const response = await request.post(url, {
    data: {
      title: 'E2E new concept',
      type: 'Guide',
      description: 'Created by the entry API spec.',
    },
  });
  expect(response.status()).toBe(201);
  expect(response.headers().location).toBe(`/task/${task}/doc/concepts/e2e-entry-new`);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    path: concept,
    url: `/task/${task}/doc/concepts/e2e-entry-new`,
    warnings: [],
  });
  expect(Number.isNaN(Date.parse(body.lastModified as string))).toBe(false);

  expect(readDataText(`task/${task}/${concept}`)).toBe(
    '---\ntype: Guide\ntitle: E2E new concept\ndescription: Created by the entry API spec.\n---\n\n# E2E new concept\n',
  );
  expect(readDataText(`task/${task}/index.md`)).toContain(
    '\n## Concepts\n\n* [E2E new concept](/concepts/e2e-entry-new.md) - Created by the entry API spec.\n',
  );
  expect(readDataText(`task/${task}/log.md`)).toMatch(
    /\n## \d{4}-\d\d-\d\d\n\* \*\*Create\*\*: Created \[E2E new concept\]\(\/concepts\/e2e-entry-new\.md\)\./,
  );

  // The new file is readable and clean.
  const got = await request.get(url);
  expect(got.status()).toBe(200);
  expect(((await got.json()) as { warnings: unknown[] }).warnings).toEqual([]);

  const again = await request.post(url, { data: { title: 'E2E new concept' } });
  expect(again.status()).toBe(409);
  expect((await errorOf(again)).error).toBe('exists');

  // A second concept lands under the same heading.
  const second = await request.post(`${API}/doc/task/${task}/concepts/e2e-entry-second.md`, {
    data: { title: 'Second' },
  });
  expect(second.status()).toBe(201);
  const index = readDataText(`task/${task}/index.md`);
  expect(index.match(/## Concepts/g)).toHaveLength(1);
  expect(index).toContain('* [Second](/concepts/e2e-entry-second.md) - Second\n');
});

test('POST /api/doc rejects reserved paths, skills, bad bodies, missing entries and wrong content types', async ({
  request,
}) => {
  const post = (url: string, data: unknown) => request.post(`${API}/doc/${url}`, { data });
  expect((await post(`task/${task}/index.md`, { title: 'X' })).status()).toBe(400);
  expect((await post(`task/${task}/concepts/index.md`, { title: 'X' })).status()).toBe(400);
  expect((await post(`task/${task}/concepts/log.md`, { title: 'X' })).status()).toBe(400);
  expect((await post(`task/${task}/x.txt`, { title: 'X' })).status()).toBe(400);
  const skill = await post('skill/ctxman-add-entry/references/e2e-x.md', { title: 'X' });
  expect(skill.status()).toBe(400);
  expect((await errorOf(skill)).error).toBe('bad-dataset');
  const noEntry = await post('task/e2e-no-such-entry/a.md', { title: 'X' });
  expect(noEntry.status()).toBe(404);
  const noTitle = await post(`task/${task}/concepts/e2e-no-title.md`, { type: 'Guide' });
  expect(noTitle.status()).toBe(400);
  expect((await errorOf(noTitle)).issues).toEqual([{ path: 'title', message: 'is required' }]);
  expect(existsSync(dataPath(`task/${task}/concepts/e2e-no-title.md`))).toBe(false);

  const media = await request.post(`${API}/doc/task/${task}/concepts/e2e-media.md`, {
    headers: { 'content-type': 'text/plain' },
    data: '{}',
  });
  expect(media.status()).toBe(415);
  const origin = await request.post(`${API}/doc/task/${task}/concepts/e2e-origin.md`, {
    headers: { ...jsonHeaders, origin: 'http://evil.example' },
    data: { title: 'X' },
  });
  expect(origin.status()).toBe(403);
});

test('POST /api/context/:slug/links appends new links and skips present ones', async ({
  request,
}) => {
  const created = await request.post(`${API}/context`, {
    data: {
      name: ctx,
      description: 'Context for the entry API spec.',
      links: [{ dataset: 'kb', slug: 'ctxman', notes: 'Keep these notes.' }],
    },
  });
  expect(created.status()).toBe(201);

  const url = `${API}/context/${ctx}/links`;
  const response = await request.post(url, {
    data: {
      links: [
        { dataset: 'task', slug: task, notes: 'The task.' },
        { dataset: 'kb', slug: 'ctxman', notes: 'IGNORED' },
        { dataset: 'project', slug: project },
      ],
    },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    context: { links: { dataset: string; slug: string; notes?: string }[] };
    lastModified: string;
    added: string[];
    skipped: string[];
  };
  expect(body.added).toEqual([`task/${task}`, `project/${project}`]);
  expect(body.skipped).toEqual(['kb/ctxman']);
  expect(body.context.links.map((l) => `${l.dataset}/${l.slug}`)).toEqual([
    'kb/ctxman',
    `task/${task}`,
    `project/${project}`,
  ]);
  expect(body.context.links[0]?.notes).toBe('Keep these notes.\n');
  const saved = readDataText(`context/${ctx}.yaml`);
  expect(saved).toContain('Keep these notes.');
  expect(saved).not.toContain('IGNORED');

  const again = await request.post(url, { data: { links: [{ dataset: 'task', slug: task }] } });
  expect(again.status()).toBe(200);
  const second = (await again.json()) as typeof body;
  expect(second.added).toEqual([]);
  expect(second.skipped).toEqual([`task/${task}`]);
  expect(second.lastModified).toBe(body.lastModified);
});

test('POST /api/context/:slug/links errors and guards', async ({ request }) => {
  const url = `${API}/context/${ctx}/links`;
  const invalid = await request.post(url, {
    data: {
      links: [
        { dataset: 'context', slug: 'x' },
        { dataset: 'kb', slug: 'Bad' },
      ],
    },
  });
  expect(invalid.status()).toBe(400);
  expect((await errorOf(invalid)).issues?.map((i) => i.path)).toEqual([
    'links.0.dataset',
    'links.1.slug',
  ]);
  expect((await request.post(url, { data: { links: [] } })).status()).toBe(400);
  const slug = await request.post(`${API}/context/Bad_Slug/links`, {
    data: { links: [{ dataset: 'kb', slug: 'a' }] },
  });
  expect(slug.status()).toBe(400);
  expect((await errorOf(slug)).error).toBe('bad-slug');
  const missing = await request.post(`${API}/context/e2e-no-such-ctx/links`, {
    data: { links: [{ dataset: 'kb', slug: 'a' }] },
  });
  expect(missing.status()).toBe(404);
  expect((await errorOf(missing)).error).toBe('not-found');

  const media = await request.post(url, { headers: { 'content-type': 'text/plain' }, data: '{}' });
  expect(media.status()).toBe(415);
  const origin = await request.post(url, {
    headers: { ...jsonHeaders, origin: 'http://evil.example' },
    data: { links: [{ dataset: 'kb', slug: 'a' }] },
  });
  expect(origin.status()).toBe(403);
  const get = await request.get(url);
  expect(get.status()).toBe(405);
  expect(get.headers().allow).toBe('POST');

  // The sibling /api/context/:slug route still works next to the links route.
  expect((await request.get(`${API}/context/${ctx}`)).status()).toBe(200);
});
