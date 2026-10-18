import { ICONS, type IconName } from './icons.ts';
import { cx } from './utils.ts';

export interface IconProps {
  name: IconName;
  /** Rendered width and height in px. Default 16. */
  size?: number;
  className?: string;
}

/** Inline SVG from the shared `ICONS` table; `currentColor`, decorative (`aria-hidden`). */
export function Icon({ name, size = 16, className }: IconProps) {
  const def = ICONS[name];
  return (
    <svg
      className={cx('ck-icon', className)}
      width={size}
      height={size}
      viewBox={def.viewBox}
      aria-hidden="true"
      focusable="false"
      fill={def.stroke ? 'none' : 'currentColor'}
      stroke={def.stroke ? 'currentColor' : undefined}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {def.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {def.circles?.map(([cx0, cy, r]) => (
        <circle key={`${cx0}-${cy}`} cx={cx0} cy={cy} r={r} />
      ))}
    </svg>
  );
}
