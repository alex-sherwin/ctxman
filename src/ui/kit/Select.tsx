import type { ReactNode } from 'react';
import {
  Autocomplete,
  Button as AriaButton,
  FieldError,
  Label,
  Select as AriaSelect,
  SelectValue,
  Text,
  useFilter,
  type AutocompleteProps,
  type Key,
  type SelectProps as AriaSelectProps,
  type ValidationResult,
} from 'react-aria-components';
import { SearchField } from './Field.tsx';
import { Icon } from './Icon.tsx';
import { ListBox } from './ListBox.tsx';
import { Popover } from './Popover.tsx';
import { kitClass } from './utils.ts';

export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, 'children'> {
  label?: string;
  description?: string;
  errorMessage?: string | ((v: ValidationResult) => string);
  items?: Iterable<T>;
  /** `<ListBoxItem>`s (import from the kit), or a render function when `items` is given. */
  children: ReactNode | ((item: T) => ReactNode);
  size?: 'sm' | 'md';
  /**
   * `data-testid` of the trigger button. The filter input gets `${triggerTestId}-search`, the popover
   * `${triggerTestId}-popover`.
   */
  triggerTestId?: string;
  /** Default true: a filter input on top of the list. */
  searchable?: boolean;
  /** Placeholder of the filter input. Default 'Filter…'. */
  searchPlaceholder?: string;
  /** Item keys that are never filtered out (e.g. a "+ New context…" action item). */
  pinnedKeys?: Iterable<Key>;
  /** Shown when the filter matches nothing. Default 'No matches'. */
  emptyText?: string;
}

/**
 * Single-select dropdown. 1.22 API: `value` / `onChange`.
 * The popover holds an Autocomplete (filter input + listbox): opening focuses the input, typing filters,
 * Enter selects, Esc clears the query then closes.
 */
export function Select<T extends object>({
  label,
  description,
  errorMessage,
  items,
  children,
  size = 'md',
  triggerTestId,
  searchable = true,
  searchPlaceholder = 'Filter…',
  pinnedKeys,
  emptyText = 'No matches',
  className,
  ...rest
}: SelectProps<T>) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const pinned = new Set(pinnedKeys ?? []);
  const filter: NonNullable<AutocompleteProps['filter']> = (text, input, node) =>
    pinned.has(node.key) || contains(text, input);
  const list = (
    <ListBox
      items={items}
      renderEmptyState={() => <div className="ck-select__empty">{emptyText}</div>}
    >
      {children}
    </ListBox>
  );
  return (
    <AriaSelect {...rest} className={kitClass(className, 'ck-select', `ck-select--${size}`)}>
      {label && <Label className="ck-field__label">{label}</Label>}
      <AriaButton className="ck-select__trigger" data-testid={triggerTestId}>
        <SelectValue className="ck-select__value" />
        <span className="ck-select__chevron" aria-hidden="true">
          <Icon name="chevron" size={16} />
        </span>
      </AriaButton>
      {description && (
        <Text slot="description" className="ck-field__description">
          {description}
        </Text>
      )}
      <FieldError className="ck-field__error">{errorMessage}</FieldError>
      <Popover
        className="ck-select__popover"
        placement="bottom start"
        data-testid={triggerTestId ? `${triggerTestId}-popover` : undefined}
      >
        {searchable ? (
          <Autocomplete filter={filter}>
            <SearchField
              aria-label={`Filter ${label ?? rest['aria-label'] ?? 'options'}`}
              autoFocus
              size="sm"
              className="ck-select__search"
              placeholder={searchPlaceholder}
              inputTestId={triggerTestId ? `${triggerTestId}-search` : undefined}
            />
            {list}
          </Autocomplete>
        ) : (
          list
        )}
      </Popover>
    </AriaSelect>
  );
}
