// PURE helpers for the collapsed "Notes for the agent" summary (UI_SPEC §H.5).

/** Number of lines in `notes`, ignoring trailing newlines. */
export function lineCount(notes: string): number {
  const text = notes.replace(/\s+$/, '');
  return text === '' ? 0 : text.split('\n').length;
}

/** First non-blank line, trimmed and cut to `max` characters with an ellipsis. */
export function firstLine(notes: string, max: number): string {
  const line =
    notes
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? '';
  return line.length > max ? `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…` : line;
}

/** `1 line`, `2 lines`. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
