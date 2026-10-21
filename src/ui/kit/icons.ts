// PURE data: icon definitions shared by the React `Icon` (src/ui/kit/Icon.tsx) and the SSR twin
// (src/components/Icon.astro). No imports; browser- and server-safe.
export type IconName =
  | 'check'
  | 'chevron'
  | 'grip'
  | 'pencil'
  | 'close'
  | 'arrow-up'
  | 'arrow-down'
  | 'external'
  | 'plus'
  | 'more'
  | 'clock'
  | 'trash';

export interface IconDef {
  viewBox: string;
  /** Stroked outline icon (`fill="none"`, `stroke="currentColor"`) or filled shape (`fill="currentColor"`). */
  stroke: boolean;
  paths: string[];
  /** `[cx, cy, r]` triples. */
  circles?: [number, number, number][];
}

export const ICONS: Record<IconName, IconDef> = {
  check: { viewBox: '0 0 16 16', stroke: true, paths: ['M3 8.5l3.2 3.2L13 4.5'] },
  chevron: { viewBox: '0 0 16 16', stroke: true, paths: ['M4 6l4 4 4-4'] },
  grip: {
    viewBox: '0 0 10 16',
    stroke: false,
    paths: [],
    circles: [
      [3, 4, 1.2],
      [7, 4, 1.2],
      [3, 8, 1.2],
      [7, 8, 1.2],
      [3, 12, 1.2],
      [7, 12, 1.2],
    ],
  },
  pencil: { viewBox: '0 0 16 16', stroke: true, paths: ['M10.5 2.5l3 3-8 8H2.5v-3z', 'M9 4l3 3'] },
  close: { viewBox: '0 0 16 16', stroke: true, paths: ['M4 4l8 8', 'M12 4l-8 8'] },
  'arrow-up': { viewBox: '0 0 16 16', stroke: true, paths: ['M8 13V3', 'M3.5 7.5 8 3l4.5 4.5'] },
  'arrow-down': { viewBox: '0 0 16 16', stroke: true, paths: ['M8 3v10', 'M3.5 8.5 8 13l4.5-4.5'] },
  external: { viewBox: '0 0 16 16', stroke: true, paths: ['M6 3h7v7', 'M13 3 5 11', 'M3 6v7h7'] },
  plus: { viewBox: '0 0 16 16', stroke: true, paths: ['M8 3v10', 'M3 8h10'] },
  more: {
    viewBox: '0 0 16 16',
    stroke: false,
    paths: [],
    circles: [
      [3, 8, 1.3],
      [8, 8, 1.3],
      [13, 8, 1.3],
    ],
  },
  clock: {
    viewBox: '0 0 16 16',
    stroke: true,
    paths: ['M8 4.8V8l2.3 1.5'],
    circles: [[8, 8, 5.8]],
  },
  trash: {
    viewBox: '0 0 16 16',
    stroke: true,
    paths: [
      'M2.5 4.5h11',
      'M6 4.5V2.8h4v1.7',
      'M4 4.5l.7 8.7h6.6l.7-8.7',
      'M6.7 7v3.8',
      'M9.3 7v3.8',
    ],
  },
};

/**
 * The SSR `Icon` (src/components/Icon.astro) as an HTML string, for markup built outside a component: the copy
 * button that src/lib/markdown.ts puts on rendered code blocks. Decorative (`aria-hidden`), `currentColor`.
 */
export function iconSvg(name: IconName, size: number, className?: string): string {
  const def = ICONS[name];
  const cls = className === undefined ? 'ck-icon' : `ck-icon ${className}`;
  const paint = def.stroke ? 'fill="none" stroke="currentColor"' : 'fill="currentColor"';
  const shapes = [
    ...def.paths.map((d) => `<path d="${d}"></path>`),
    ...(def.circles ?? []).map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"></circle>`),
  ].join('');
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="${def.viewBox}" aria-hidden="true" focusable="false" ${paint} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
}
