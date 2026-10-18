import { Checkbox as AriaCheckbox, type CheckboxProps } from 'react-aria-components';
import { kitClass } from './utils.ts';

/** Children are the label. */
export function Checkbox({ className, children, ...rest }: CheckboxProps) {
  return (
    <AriaCheckbox {...rest} className={kitClass(className, 'ck-checkbox')}>
      {(rp) => (
        <>
          <span className="ck-checkbox__box" aria-hidden="true">
            <svg viewBox="0 0 12 12" width="100%" height="100%" fill="none" stroke="currentColor">
              {rp.isIndeterminate ? (
                <path d="M3 6h6" strokeWidth="1.8" />
              ) : (
                <path d="M2.5 6.2 5 8.7 9.5 3.5" strokeWidth="1.8" />
              )}
            </svg>
          </span>
          {typeof children === 'function' ? children(rp) : children}
        </>
      )}
    </AriaCheckbox>
  );
}
