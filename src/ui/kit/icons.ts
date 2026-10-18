// PURE data: icon definitions shared by the React `Icon` (src/ui/kit/Icon.tsx) and the SSR twin
// (src/components/Icon.astro). No imports; browser- and server-safe.
export type IconName = 'check' | 'chevron' | 'grip' | 'pencil';

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
};
