import type { ReactNode } from 'react';
import {
  Collection,
  Header,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Popover as AriaPopover,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps,
  type MenuSectionProps,
  type PopoverProps,
} from 'react-aria-components';
import { cx, kitClass } from './utils.ts';

export { MenuTrigger };

/** Floating panel for Select / Menu. Default offset 2. */
export function Popover({ offset = 2, className, ...rest }: PopoverProps) {
  return <AriaPopover offset={offset} {...rest} className={kitClass(className, 'ck-popover')} />;
}

export function Menu<T extends object>({ className, ...rest }: MenuProps<T>) {
  return <AriaMenu {...rest} className={kitClass(className, 'ck-menu')} />;
}

export interface MenuItemProps extends AriaMenuItemProps {
  /** Shortcut hint, e.g. 'Del'. Rendered as a `<kbd class="ck-kbd">`. */
  shortcut?: string;
  tone?: 'danger';
}

export function MenuItem({
  shortcut,
  tone,
  textValue,
  className,
  children,
  ...rest
}: MenuItemProps) {
  const text = textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <AriaMenuItem
      {...rest}
      textValue={text}
      className={kitClass(className, 'ck-menu__item', tone === 'danger' && 'ck-menu__item--danger')}
    >
      {(rp) => (
        <>
          {typeof children === 'function' ? children(rp) : children}
          {shortcut && <Keyboard className="ck-kbd ck-menu__shortcut">{shortcut}</Keyboard>}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSection<T extends object>({
  title,
  className,
  items,
  children,
  ...rest
}: MenuSectionProps<T> & { title?: ReactNode }) {
  return (
    <AriaMenuSection {...rest} className={cx('ck-menu__section', className)}>
      {title != null && <Header className="ck-menu__header">{title}</Header>}
      <Collection items={items}>{children}</Collection>
    </AriaMenuSection>
  );
}
