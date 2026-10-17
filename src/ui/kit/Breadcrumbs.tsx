import {
  Breadcrumb,
  Breadcrumbs as AriaBreadcrumbs,
  Link as AriaLink,
} from 'react-aria-components';
import { cx } from './utils.ts';

export interface BreadcrumbsProps {
  /** The last item is the current page (rendered without a link). */
  items: { label: string; href?: string; mono?: boolean }[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <AriaBreadcrumbs className="ck-breadcrumbs">
      {items.map((item, i) => (
        <Breadcrumb
          key={`${i}:${item.label}`}
          id={`${i}:${item.label}`}
          className="ck-breadcrumbs__item"
        >
          <AriaLink
            href={i === items.length - 1 ? undefined : item.href}
            className={cx('ck-breadcrumbs__link', item.mono && 'ck-breadcrumbs__link--mono')}
          >
            {item.label}
          </AriaLink>
        </Breadcrumb>
      ))}
    </AriaBreadcrumbs>
  );
}
