import type { ReactNode } from 'react';
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
}

export interface ChipGroupProps extends ToggleButtonGroupProps {
  /** Becomes the group's aria-label. */
  label?: string;
}

/** A toggle chip (`aria-pressed`). Use inside a `ChipGroup` for arrow-key navigation. */
export function Chip({ count, dataset, className, children, ...rest }: ChipProps) {
  return (
    <AriaToggleButton {...rest} data-ds={dataset} className={kitClass(className, 'ck-chip')}>
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

export interface ChipToggleOption<K extends string> {
  id: K;
  label: ReactNode;
  testId?: string;
  isDisabled?: boolean;
}

export interface ChipToggleProps<K extends string> {
  /** `aria-label` of the group. */
  label: string;
  value: K;
  /** Called only when the selection moves to another option. */
  onChange: (next: K) => void;
  options: readonly ChipToggleOption<K>[];
  /** `data-testid` of the group. */
  testId?: string;
  className?: string;
}

/** A single-select group of chips over a fixed option list (a radio group that looks like chips). */
export function ChipToggle<K extends string>({
  label,
  value,
  onChange,
  options,
  testId,
  className,
}: ChipToggleProps<K>) {
  return (
    <ChipGroup
      label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const key = [...keys][0];
        const option = options.find((o) => o.id === key);
        if (option && option.id !== value) onChange(option.id);
      }}
      data-testid={testId}
      className={className}
    >
      {options.map((o) => (
        <Chip key={o.id} id={o.id} isDisabled={o.isDisabled} data-testid={o.testId}>
          {o.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}
