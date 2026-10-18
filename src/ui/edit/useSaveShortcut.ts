// Browser-only hook. Cmd/Ctrl+S (no Alt/Shift) on `window`, CAPTURE phase: react-aria grid rows stop key events
// that start inside a row, so a bubble listener would miss them. Ignores events a Monaco save action already
// handled (`defaultPrevented`). Registered only while `enabled`. `onSave` must be stable (a store action, or a
// closure wrapped in the latest-callback ref pattern), or the listener is re-registered on every render.
import { useEffect } from 'react';

export function useSaveShortcut(onSave: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onSave, enabled]);
}
