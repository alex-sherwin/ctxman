// PURE text helpers shared by islands and stores.

/** Number of lines in `text`, ignoring trailing whitespace. */
export function lineCount(text: string): number {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}

/** First non-blank line, trimmed and cut to `max` characters with an ellipsis. */
export function firstLine(text: string, max: number): string {
  const line =
    text
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? '';
  return line.length > max ? `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…` : line;
}

/** `1 line`, `2 lines`. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
