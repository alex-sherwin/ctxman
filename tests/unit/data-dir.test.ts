import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SERVER_ORIGIN,
  DataDirError,
  dataDirStatus,
  resolveDataDir,
  resolveServerOrigin,
} from '../../src/lib/data-dir.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('resolveDataDir', () => {
  it('throws DataDirError(unset) when the variable is absent or blank', () => {
    for (const env of [{}, { CTXMAN_DATA_DIR: '' }, { CTXMAN_DATA_DIR: '   ' }]) {
      try {
        resolveDataDir(env);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DataDirError);
        expect((error as DataDirError).code).toBe('unset');
        expect((error as DataDirError).message).toContain('CTXMAN_DATA_DIR is not set');
      }
    }
  });

  it('resolves relative values against the cwd and keeps absolute ones', () => {
    expect(resolveDataDir({ CTXMAN_DATA_DIR: 'rel/dir' })).toBe(path.resolve('rel/dir'));
    const abs = path.resolve(path.sep, 'srv', 'data');
    expect(resolveDataDir({ CTXMAN_DATA_DIR: abs })).toBe(abs);
  });

  it('is pinned to an empty temp dir inside the unit tests (never the repo corpus)', () => {
    const dir = resolveDataDir();
    expect(dir).not.toBe(path.resolve('tests', 'data'));
    expect(dir).not.toBe(path.resolve('data'));
  });
});

describe('dataDirStatus', () => {
  it('reports ok / unset / missing / not-directory', () => {
    const dir = tmp.make({ 'file.txt': 'x' });
    expect(dataDirStatus({ CTXMAN_DATA_DIR: dir })).toEqual({ ok: true, dir });
    expect(dataDirStatus({})).toMatchObject({ ok: false, code: 'unset' });
    expect(dataDirStatus({ CTXMAN_DATA_DIR: path.join(dir, 'nope') })).toMatchObject({
      ok: false,
      code: 'missing',
    });
    expect(dataDirStatus({ CTXMAN_DATA_DIR: path.join(dir, 'file.txt') })).toMatchObject({
      ok: false,
      code: 'not-directory',
    });
  });
});

describe('resolveServerOrigin', () => {
  it('defaults, strips a trailing slash and ignores non-http(s) values', () => {
    expect(resolveServerOrigin({})).toBe(DEFAULT_SERVER_ORIGIN);
    expect(resolveServerOrigin({ CTXMAN_SERVER_ORIGIN: 'http://localhost:9000/' })).toBe(
      'http://localhost:9000',
    );
    expect(resolveServerOrigin({ CTXMAN_SERVER_ORIGIN: 'ftp://x' })).toBe(DEFAULT_SERVER_ORIGIN);
    expect(resolveServerOrigin({ CTXMAN_SERVER_ORIGIN: 'not a url' })).toBe(DEFAULT_SERVER_ORIGIN);
  });
});
