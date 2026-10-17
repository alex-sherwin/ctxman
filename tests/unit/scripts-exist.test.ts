import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCRIPTS } from '../../src/lib/scripts-allowlist.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('scripts allowlist', () => {
  it('lists at least one script', () => {
    expect(SCRIPTS.length).toBeGreaterThan(0);
  });

  it.each(SCRIPTS.map((s) => s.file))('%s exists on disk', (file) => {
    expect(file.startsWith('scripts/'), file).toBe(true);
    expect(existsSync(path.join(ROOT, file)), file).toBe(true);
  });
});
