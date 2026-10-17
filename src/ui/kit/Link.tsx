import { Link as AriaLink, type LinkProps as AriaLinkProps } from 'react-aria-components';
import { kitClass } from './utils.ts';

export interface LinkProps extends AriaLinkProps {
  /** Opens in a new tab with a trailing arrow and an sr-only hint. */
  external?: boolean;
}

export function Link({ external, className, children, ...rest }: LinkProps) {
  return (
    <AriaLink
      {...rest}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={kitClass(className, 'ck-link')}
    >
      {(rp) => (
        <>
          {typeof children === 'function' ? children(rp) : children}
          {external && (
            <>
              <span aria-hidden="true"> ↗</span>
              <span className="ck-sr-only"> (opens in new tab)</span>
            </>
          )}
        </>
      )}
    </AriaLink>
  );
}
