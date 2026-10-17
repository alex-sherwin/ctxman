import type { ReactNode } from 'react';
import {
  Collection,
  Header,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  ListBoxSection as AriaListBoxSection,
  Text,
  type ListBoxItemProps as AriaListBoxItemProps,
  type ListBoxProps,
  type ListBoxSectionProps,
} from 'react-aria-components';
import { cx, kitClass } from './utils.ts';

export type { ListBoxProps, ListBoxSectionProps };

export interface ListBoxItemProps<T> extends AriaListBoxItemProps<T> {
  /** Secondary line (renders `<Text slot="label">` + `<Text slot="description">`). */
  description?: ReactNode;
}

export function ListBox<T extends object>({ className, ...rest }: ListBoxProps<T>) {
  return <AriaListBox {...rest} className={kitClass(className, 'ck-listbox')} />;
}

/** The ONLY ListBoxItem to import (oxlint blocks the raw one outside src/ui/kit). */
export function ListBoxItem<T extends object>({
  description,
  children,
  textValue,
  className,
  ...rest
}: ListBoxItemProps<T>) {
  const text = textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <AriaListBoxItem {...rest} textValue={text} className={kitClass(className, 'ck-listbox__item')}>
      {(rp) => {
        const content = typeof children === 'function' ? children(rp) : children;
        return (
          <>
            {description != null ? (
              <span className="ck-listbox__text">
                <Text slot="label">{content}</Text>
                <Text slot="description" className="ck-listbox__desc">
                  {description}
                </Text>
              </span>
            ) : (
              content
            )}
            {rp.isSelected && (
              <span className="ck-listbox__check" aria-hidden="true">
                ✓
              </span>
            )}
          </>
        );
      }}
    </AriaListBoxItem>
  );
}

export function ListBoxSection<T extends object>({
  title,
  className,
  items,
  children,
  ...rest
}: ListBoxSectionProps<T> & { title: ReactNode }) {
  return (
    <AriaListBoxSection {...rest} className={cx('ck-listbox__section', className)}>
      <Header className="ck-listbox__header">{title}</Header>
      <Collection items={items}>{children}</Collection>
    </AriaListBoxSection>
  );
}
