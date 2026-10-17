import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Label,
  Select as AriaSelect,
  SelectValue,
  Text,
  type SelectProps as AriaSelectProps,
  type ValidationResult,
} from 'react-aria-components';
import { ListBox } from './ListBox.tsx';
import { Popover } from './Menu.tsx';
import { kitClass } from './utils.ts';

export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, 'children'> {
  label?: string;
  description?: string;
  errorMessage?: string | ((v: ValidationResult) => string);
  items?: Iterable<T>;
  /** `<ListBoxItem>`s (import from the kit), or a render function when `items` is given. */
  children: ReactNode | ((item: T) => ReactNode);
  size?: 'sm' | 'md';
  /** `data-testid` of the trigger button. */
  triggerTestId?: string;
}

/** Single-select dropdown. 1.22 API: `value` / `onChange`. */
export function Select<T extends object>({
  label,
  description,
  errorMessage,
  items,
  children,
  size = 'md',
  triggerTestId,
  className,
  ...rest
}: SelectProps<T>) {
  return (
    <AriaSelect {...rest} className={kitClass(className, 'ck-select', `ck-select--${size}`)}>
      {label && <Label className="ck-field__label">{label}</Label>}
      <AriaButton className="ck-select__trigger" data-testid={triggerTestId}>
        <SelectValue className="ck-select__value" />
        <span className="ck-select__chevron" aria-hidden="true">
          ▾
        </span>
      </AriaButton>
      {description && (
        <Text slot="description" className="ck-field__description">
          {description}
        </Text>
      )}
      <FieldError className="ck-field__error">{errorMessage}</FieldError>
      <Popover className="ck-select__popover">
        <ListBox items={items}>{children}</ListBox>
      </Popover>
    </AriaSelect>
  );
}
