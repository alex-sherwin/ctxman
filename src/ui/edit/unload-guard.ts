// Browser-only, React-free: the switch behind `useUnsavedGuard`. The guard prompts before the tab is closed,
// reloaded or navigated away while a form holds unsaved edits. A store that is about to navigate after a
// SUCCESSFUL write calls `allowUnload()` first: the prompt must never show on the happy path, and React may not
// have re-rendered the form clean (and removed the listener) by the time the navigation starts. The guard
// re-arms itself whenever a form becomes dirty again.
let allowed = false;

/** The next unload is wanted (a write succeeded and the page navigates or reloads): no prompt. */
export function allowUnload(): void {
  allowed = true;
}

/** A form became dirty: prompt again on unload. */
export function armUnloadGuard(): void {
  allowed = false;
}

export function isUnloadAllowed(): boolean {
  return allowed;
}
