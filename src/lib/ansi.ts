// PURE: strip ANSI CSI escape sequences (colors, cursor moves) from script output before display
// (UI_SPEC §I.4). Scripts run with NO_COLOR/FORCE_COLOR=0, this is the belt to those braces.
// ESC is a control character on purpose.
// oxlint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_CSI, '');
}
