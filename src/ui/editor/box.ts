// PURE (no Monaco): the sizing constants and root classes of the `.ck-code` box. Shared by CodeEditor and the
// LazyCodeEditor Suspense fallback so the placeholder has the same height and no layout shift on load.
import { cx } from '../kit/utils.ts';

export type CodeLanguage = 'markdown' | 'json' | 'yaml';

export type CodeHeight =
  | { mode: 'auto'; minLines?: number; maxLines?: number }
  | { mode: 'fill' }
  | { mode: 'fixed'; px: number };

export const LINE_PX = 18;
export const PAD_PX = 8; // padding top + bottom (4 + 4)
export const BORDER_PX = 2; // .ck-code border (1px each side; box-sizing is border-box)
export const DEFAULT_MIN_LINES = 8;
export const DEFAULT_MAX_LINES = 20;

export interface BoxLimits {
  minPx: number;
  maxPx: number;
}

export function boxLimits(height: CodeHeight | undefined): BoxLimits {
  const minLines = (height?.mode === 'auto' ? height.minLines : undefined) ?? DEFAULT_MIN_LINES;
  const maxLines = (height?.mode === 'auto' ? height.maxLines : undefined) ?? DEFAULT_MAX_LINES;
  return {
    minPx: minLines * LINE_PX + PAD_PX + BORDER_PX,
    maxPx: maxLines * LINE_PX + PAD_PX + BORDER_PX,
  };
}

/** Inline style of the root before Monaco reports its content height (undefined = CSS decides). */
export function initialBoxStyle(height: CodeHeight | undefined): { height: number } | undefined {
  const mode = height?.mode ?? 'auto';
  if (height?.mode === 'fixed') return { height: height.px };
  return mode === 'auto' ? { height: boxLimits(height).minPx } : undefined;
}

export function boxClass(opts: {
  language: CodeLanguage;
  height?: CodeHeight | undefined;
  compact?: boolean;
  readOnly?: boolean;
}): string {
  return cx(
    'ck-code',
    `ck-code--${opts.language}`,
    opts.compact && 'ck-code--compact',
    opts.readOnly && 'ck-code--readonly',
    opts.height?.mode === 'fill' && 'ck-code--fill',
  );
}
