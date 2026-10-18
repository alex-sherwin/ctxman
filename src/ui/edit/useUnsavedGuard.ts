// Browser hook: ask before the tab is closed / reloaded / navigated away while an editor holds unsaved edits.
// The listener exists only while `dirty` (no permanent handler, nothing for the dev reload to trip over; a
// `location.reload()` after a successful save runs when the editor is already clean).
import { useEffect } from 'react';

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
