import { Popover as AriaPopover, type PopoverProps } from 'react-aria-components';
import { kitClass } from './utils.ts';

/** Floating panel for Select / Menu. Default offset 2. */
export function Popover({ offset = 2, className, ...rest }: PopoverProps) {
  return <AriaPopover offset={offset} {...rest} className={kitClass(className, 'ck-popover')} />;
}
