// Browser hook: ask before the tab is closed / reloaded / navigated away while an editor holds unsaved edits.
// The listener exists only while `dirty`. It is a no-op once `allowUnload()` (unload-guard.ts) was called: a
// store navigating after a successful write calls it first, so the happy path never prompts even though React
// has not yet re-rendered the form clean. Becoming dirty re-arms the guard.
import { useEffect } from 'react';
import { armUnloadGuard, isUnloadAllowed } from './unload-guard.ts';

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    armUnloadGuard();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isUnloadAllowed()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
