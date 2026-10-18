import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps,
  type TabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps,
} from 'react-aria-components';
import type { DatasetId } from '../../datasets/registry.ts';
import { kitClass } from './utils.ts';

export interface TabProps extends AriaTabProps {
  /** A number, `null` for "still loading" (a dimmed ellipsis), `undefined` for no count. */
  count?: number | null;
  /** Colors the selected tab with the dataset's color and adds a dot. */
  dataset?: DatasetId;
}

/** Controlled: `selectedKey` / `onSelectionChange`. Arrow keys move and activate. */
export function Tabs({ className, ...rest }: TabsProps) {
  return <AriaTabs {...rest} className={kitClass(className, 'ck-tabs')} />;
}

export function TabList<T extends object>({ className, ...rest }: TabListProps<T>) {
  return <AriaTabList {...rest} className={kitClass(className, 'ck-tabs__list')} />;
}

export function Tab({ count, dataset, className, children, ...rest }: TabProps) {
  return (
    <AriaTab {...rest} data-ds={dataset} className={kitClass(className, 'ck-tabs__tab')}>
      {(rp) => (
        <>
          {dataset && <span className="ck-tabs__dot" aria-hidden="true" />}
          {typeof children === 'function' ? children(rp) : children}
          {count === null && (
            <span className="ck-tabs__count" data-loading="" aria-label="loading">
              …
            </span>
          )}
          {typeof count === 'number' && <span className="ck-tabs__count">{count}</span>}
        </>
      )}
    </AriaTab>
  );
}

export function TabPanel({ className, ...rest }: TabPanelProps) {
  return <AriaTabPanel {...rest} className={kitClass(className, 'ck-tabs__panel')} />;
}
