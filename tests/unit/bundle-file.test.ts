import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleFileContentType, bundleFileResponse } from '../../src/lib/bundle-file.ts';
import { trackTemp, validKbBundle } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const get = (headers?: HeadersInit) => new Request('http://127.0.0.1:4321/x', { headers });

function setup(): string {
  const dataDir = tmp.make({
    ...validKbBundle('demo'),
    'kb/demo/img/a b.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'kb/demo/notes.txt': 'plain',
    'skill/s/SKILL.md': '---\nname: s\ndescription: d\n---\n',
    'outside.png': 'secret',
  });
  writeFileSync(path.join(dataDir, 'kb/demo/now.heic'), PNG);
  writeFileSync(path.join(dataDir, 'kb/demo/blob'), PNG);
  mkdirSync(path.join(dataDir, 'skill/s/assets'));
  writeFileSync(path.join(dataDir, 'skill/s/assets/x.png'), PNG);
  return dataDir;
}

describe('bundleFileResponse', () => {
  it('serves the bytes of a bundle file with its content type, no-cache and an ETag', async () => {
    const dataDir = setup();
    const res = await bundleFileResponse('kb', 'demo', 'now.heic', get(), dataDir);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/heic');
    expect(res.headers.get('content-length')).toBe(String(PNG.length));
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('etag')).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);

    const skill = await bundleFileResponse('skill', 's', 'assets/x.png', get(), dataDir);
    expect(skill.status).toBe(200);
    expect(skill.headers.get('content-type')).toBe('image/png');
  });

  it('answers 304 when If-None-Match matches the current ETag', async () => {
    const dataDir = setup();
    const first = await bundleFileResponse('kb', 'demo', 'now.heic', get(), dataDir);
    const etag = first.headers.get('etag') ?? '';
    const again = await bundleFileResponse(
      'kb',
      'demo',
      'now.heic',
      get({ 'if-none-match': etag }),
      dataDir,
    );
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(etag);
    const stale = await bundleFileResponse(
      'kb',
      'demo',
      'now.heic',
      get({ 'if-none-match': 'W/"0-0"' }),
      dataDir,
    );
    expect(stale.status).toBe(200);
  });

  it('serves an SVG with a script-free CSP, text as text/plain, unknown binary as octet-stream', async () => {
    const dataDir = setup();
    const svg = await bundleFileResponse('kb', 'demo', 'img/a b.svg', get(), dataDir);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('content-security-policy')).toContain("default-src 'none'");
    const txt = await bundleFileResponse('kb', 'demo', 'notes.txt', get(), dataDir);
    expect(txt.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(txt.headers.get('content-security-policy')).toBeNull();
    const md = await bundleFileResponse('kb', 'demo', 'index.md', get(), dataDir);
    expect(md.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const bin = await bundleFileResponse('kb', 'demo', 'blob', get(), dataDir);
    expect(bin.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('answers 404 for a dataset without bundles, a missing entry or file, a directory, or a symlink out', async () => {
    const dataDir = setup();
    symlinkSync(path.join(dataDir, 'outside.png'), path.join(dataDir, 'kb/demo/link.png'));
    const cases: [string, string, string][] = [
      ['reference', 'demo', 'now.heic'],
      ['context', 'demo', 'now.heic'],
      ['nope', 'demo', 'now.heic'],
      ['kb', 'gone', 'now.heic'],
      ['kb', 'Bad_Slug', 'now.heic'],
      ['kb', 'demo', 'gone.png'],
      ['kb', 'demo', 'img'],
      ['kb', 'demo', 'link.png'],
    ];
    for (const [dataset, slug, rel] of cases) {
      const res = await bundleFileResponse(dataset, slug, rel, get(), dataDir);
      expect(res.status, `${dataset}/${slug}/${rel}`).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('answers 400 for paths it refuses (empty, absolute, .., dot segments, backslash, NUL)', async () => {
    const dataDir = setup();
    for (const rel of [
      undefined,
      '',
      '/now.heic',
      '../outside.png',
      'img/../now.heic',
      '.hidden',
      'a\\b',
      'a\0b',
    ]) {
      const res = await bundleFileResponse('kb', 'demo', rel, get(), dataDir);
      expect(res.status, String(rel)).toBe(400);
    }
  });
});

describe('bundleFileContentType', () => {
  it('maps image, media and PDF extensions case-insensitively', async () => {
    const dataDir = setup();
    const abs = path.join(dataDir, 'kb/demo/now.heic');
    expect(await bundleFileContentType(abs, 'X.JPG')).toBe('image/jpeg');
    expect(await bundleFileContentType(abs, 'a/b.webp')).toBe('image/webp');
    expect(await bundleFileContentType(abs, 'doc.pdf')).toBe('application/pdf');
    expect(await bundleFileContentType(abs, 'clip.mp4')).toBe('video/mp4');
  });
});
