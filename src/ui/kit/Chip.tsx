import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonGroupProps,
  type ToggleButtonProps,
} from 'react-aria-components';
import type { DatasetId } from '../../datasets/registry.ts';
import { kitClass } from './utils.ts';

export interface ChipProps extends ToggleButtonProps {
  count?: number;
  /** Colors the chip with the dataset's color and adds a dot. */
  dataset?: DatasetId;
  /** Default 'sm'. */
  size?: 'sm' | 'md';
}

export interface ChipGroupProps extends ToggleButtonGroupProps {
  /** Becomes the group's aria-label. */
  label?: string;
}

/** A toggle chip (`aria-pressed`). Use inside a `ChipGroup` for arrow-key navigation. */
export function Chip({ count, dataset, size = 'sm', className, children, ...rest }: ChipProps) {
  return (
    <AriaToggleButton
      {...rest}
      data-ds={dataset}
      className={kitClass(className, 'ck-chip', `ck-chip--${size}`)}
    >
      {(rp) => (
        <>
          {dataset && <span className="ck-chip__dot" aria-hidden="true" />}
          <span className="ck-chip__label">
            {typeof children === 'function' ? children(rp) : children}
          </span>
          {count !== undefined && <span className="ck-chip__count">{count}</span>}
        </>
      )}
    </AriaToggleButton>
  );
}

/** Group of chips. Defaults to `selectionMode="multiple"`. */
export function ChipGroup({ label, className, ...rest }: ChipGroupProps) {
  return (
    <AriaToggleButtonGroup
      selectionMode="multiple"
      {...rest}
      aria-label={label ?? rest['aria-label']}
      className={kitClass(className, 'ck-chip-group')}
    />
  );
}
