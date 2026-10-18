import { describe, expect, it } from 'vitest';
import { spawnCapture } from '../../src/lib/proc.ts';

const node = process.execPath;

describe('spawnCapture', () => {
  it('maps a missing command to 127 with the spawn error code', async () => {
    const result = await spawnCapture('definitely-not-a-ctxman-command', ['x']);
    expect(result.code).toBe(127);
    expect(result.spawnError).toBe('ENOENT');
    expect(result.aborted).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it('passes the exit code through and captures stdout', async () => {
    const ok = await spawnCapture(node, ['-e', 'console.log("hello")']);
    expect(ok.code).toBe(0);
    expect(ok.stdout.trim()).toBe('hello');
    expect(ok.tail).toEqual(['hello']);
    expect(ok.spawnError).toBeUndefined();

    const bad = await spawnCapture(node, ['-e', 'process.exit(3)']);
    expect(bad.code).toBe(3);
  });

  it('splits on \\r, \\r\\n and \\n, drops empty lines and trims trailing spaces', async () => {
    const lines: string[] = [];
    const script = String.raw`process.stdout.write("one  \rtwo\r\n\r\nthree\n"); process.stderr.write("err\rlast")`;
    const result = await spawnCapture(node, ['-e', script], { onLine: (l) => lines.push(l) });
    expect(result.code).toBe(0);
    expect([...lines].sort()).toEqual(['err', 'last', 'one', 'three', 'two']);
    expect(result.tail.length).toBe(5);
  });

  it('keeps stdout apart from stderr and joins a line split over chunks', async () => {
    const script = String.raw`process.stdout.write("par"); setTimeout(() => { process.stdout.write("tial\n"); process.stderr.write("e\n"); }, 50)`;
    const lines: string[] = [];
    const result = await spawnCapture(node, ['-e', script], { onLine: (l) => lines.push(l) });
    expect(result.stdout).toBe('partial\n');
    expect(lines).toContain('partial');
    expect(lines).toContain('e');
  });

  it('keeps at most 20 tail lines of 300 characters', async () => {
    const script = String.raw`for (let i = 0; i < 50; i++) console.log("line " + i); console.log("x".repeat(500))`;
    const result = await spawnCapture(node, ['-e', script]);
    expect(result.tail).toHaveLength(20);
    expect(result.tail[18]).toBe('line 49');
    expect(result.tail[19]).toHaveLength(300);
  });

  it('caps stdout at 64 KiB', async () => {
    const script = String.raw`process.stdout.write("a".repeat(200000))`;
    const result = await spawnCapture(node, ['-e', script]);
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(64 * 1024);
  });

  it('times out with 124', async () => {
    const result = await spawnCapture(node, ['-e', 'setTimeout(() => {}, 30000)'], {
      timeoutMs: 200,
    });
    expect(result.code).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it('aborts with 130 (also when the signal is already aborted)', async () => {
    const controller = new AbortController();
    const running = spawnCapture(node, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await running;
    expect(result.code).toBe(130);
    expect(result.aborted).toBe(true);

    const before = await spawnCapture(node, ['-e', 'console.log(1)'], {
      signal: controller.signal,
    });
    expect(before.code).toBe(130);
    expect(before.aborted).toBe(true);
    expect(before.stdout).toBe('');
  });

  it('runs in cwd with the given env and never through a shell', async () => {
    const script = String.raw`console.log(process.cwd()); console.log(process.env.CTXMAN_PROC_TEST)`;
    const cwd = process.cwd();
    const result = await spawnCapture(node, ['-e', script, '&&', 'echo', 'hacked'], {
      cwd,
      env: { ...process.env, CTXMAN_PROC_TEST: 'yes' },
    });
    expect(result.code).toBe(0);
    expect(result.tail).toEqual([cwd, 'yes']);
  });
});
