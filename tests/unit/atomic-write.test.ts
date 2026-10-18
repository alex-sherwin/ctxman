import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withFileLock, writeFileAtomic } from '../../src/lib/atomic-write.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no temp file behind', async () => {
    const dir = tmp.make({ 'a.txt': 'old' });
    await writeFileAtomic(path.join(dir, 'a.txt'), 'new ✓');
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('new ✓');
    expect(readdirSync(dir)).toEqual(['a.txt']);
  });

  it('creates a missing file, applies the mode and keeps a symlinked file a symlink when given the real path', async () => {
    const dir = tmp.make();
    const file = path.join(dir, 'b.txt');
    await writeFileAtomic(file, 'x', 0o600);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    if (process.platform === 'win32') return;
    const target = path.join(dir, 'target.txt');
    writeFileSync(target, 'one');
    symlinkSync(target, path.join(dir, 'link.txt'));
    await writeFileAtomic(target, 'two');
    expect(readFileSync(path.join(dir, 'link.txt'), 'utf8')).toBe('two');
  });

  it('removes its temp file when the rename fails', async () => {
    const dir = tmp.make();
    mkdirSync(path.join(dir, 'sub'));
    // A file cannot be renamed over a directory.
    await expect(writeFileAtomic(path.join(dir, 'sub'), 'x')).rejects.toThrow();
    await expect(writeFileAtomic(path.join(dir, 'missing', 'x.txt'), 'x')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['sub']);
  });
});

describe('withFileLock', () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('runs calls on one path one after another, in call order, and returns each result', async () => {
    const order: string[] = [];
    const run = (name: string, ms: number) =>
      withFileLock('/x/file', async () => {
        order.push(`${name}:start`);
        await sleep(ms);
        order.push(`${name}:end`);
        return name;
      });
    const results = await Promise.all([run('a', 20), run('b', 1), run('c', 5)]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('different paths do not wait for each other', async () => {
    const order: string[] = [];
    await Promise.all([
      withFileLock('/x/one', async () => {
        await sleep(30);
        order.push('one');
      }),
      withFileLock('/x/two', async () => {
        order.push('two');
      }),
    ]);
    expect(order).toEqual(['two', 'one']);
  });

  it('a rejecting call rejects only its own caller and the queue moves on', async () => {
    const first = withFileLock('/x/err', async () => {
      throw new Error('boom');
    });
    const second = withFileLock('/x/err', async () => 'fine');
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('fine');
  });

  it('keys by resolved path', async () => {
    const order: string[] = [];
    await Promise.all([
      withFileLock('/x/a/../same', async () => {
        await sleep(15);
        order.push('first');
      }),
      withFileLock('/x/same', async () => {
        order.push('second');
      }),
    ]);
    expect(order).toEqual(['first', 'second']);
  });
});
