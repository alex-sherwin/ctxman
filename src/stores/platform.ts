// Platform detection shared by islands (UI_SPEC §0.6). Same regex as src/scripts/shell.ts, which swaps the
// `[data-kbd-mod]` labels in SSR markup. Safe to import where `navigator` is missing (tests, SSR).
export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Label for the primary modifier key: `⌘` on Apple platforms, `Ctrl` elsewhere. */
export const modKeyLabel: string = isMac ? '⌘' : 'Ctrl';
