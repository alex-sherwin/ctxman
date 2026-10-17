import { Toolbar as AriaToolbar, type ToolbarProps } from 'react-aria-components';
import { kitClass } from './utils.ts';

/** Arrow keys move between controls, Tab leaves. Pass `aria-label`. */
export function Toolbar({ className, ...rest }: ToolbarProps) {
  return <AriaToolbar {...rest} className={kitClass(className, 'ck-toolbar')} />;
}
