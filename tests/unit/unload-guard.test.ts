import { beforeEach, describe, expect, it } from 'vitest';
import { allowUnload, armUnloadGuard, isUnloadAllowed } from '../../src/ui/edit/unload-guard.ts';

describe('unload guard switch', () => {
  beforeEach(() => armUnloadGuard());

  it('prompts by default (armed)', () => {
    expect(isUnloadAllowed()).toBe(false);
  });

  it('stands down for the navigation after a successful write', () => {
    allowUnload();
    expect(isUnloadAllowed()).toBe(true);
  });

  it('re-arms when a form becomes dirty again', () => {
    allowUnload();
    armUnloadGuard();
    expect(isUnloadAllowed()).toBe(false);
  });
});
