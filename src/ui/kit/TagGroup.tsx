import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Label,
  Tag as AriaTag,
  TagGroup as AriaTagGroup,
  TagList,
  type TagGroupProps as AriaTagGroupProps,
  type TagProps as AriaTagProps,
} from 'react-aria-components';
import { cx, kitClass } from './utils.ts';

export interface TagGroupProps<T> extends Omit<AriaTagGroupProps, 'children'> {
  label?: string;
  items?: Iterable<T>;
  children: ReactNode | ((item: T) => ReactNode);
  emptyText?: string;
}

/** Renders a remove button on each tag when the group has `onRemove`. */
export type TagProps = AriaTagProps;

export function TagGroup<T extends object>({
  label,
  items,
  children,
  emptyText,
  className,
  ...rest
}: TagGroupProps<T>) {
  return (
    <AriaTagGroup {...rest} className={cx('ck-taggroup', className)}>
      {label && <Label className="ck-field__label">{label}</Label>}
      <TagList
        items={items}
        className="ck-taglist"
        renderEmptyState={
          emptyText ? () => <span className="ck-taggroup__empty">{emptyText}</span> : undefined
        }
      >
        {children}
      </TagList>
    </AriaTagGroup>
  );
}

export function Tag({ className, children, textValue, ...rest }: TagProps) {
  const text = textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <AriaTag {...rest} textValue={text} className={kitClass(className, 'ck-tag')}>
      {(rp) => (
        <>
          {typeof children === 'function' ? children(rp) : children}
          {rp.allowsRemoving && (
            <AriaButton
              slot="remove"
              className="ck-tag__remove"
              aria-label={`Remove ${text ?? ''}`}
            >
              ×
            </AriaButton>
          )}
        </>
      )}
    </AriaTag>
  );
}
