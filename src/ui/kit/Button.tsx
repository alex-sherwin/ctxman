import {
  Button as AriaButton,
  Link as AriaLink,
  type ButtonProps as AriaButtonProps,
  type LinkProps as AriaLinkProps,
} from 'react-aria-components';
import { kitClass } from './utils.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends AriaButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon button with the neon yellow hover/focus glow. Requires `aria-label`. */
  iconOnly?: boolean;
  /** The icon-button glow on a small text utility button (Copy, Esc). Implied by `iconOnly`. */
  glow?: boolean;
}

export interface ButtonLinkProps extends AriaLinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon button with the neon yellow hover/focus glow. Requires `aria-label`. */
  iconOnly?: boolean;
  /** The icon-button glow on a small text utility button (Copy, Esc). Implied by `iconOnly`. */
  glow?: boolean;
}

/** RAC Button styled as `.ck-button`. `isPending` shows a spinner over the hidden label. */
export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly,
  glow,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <AriaButton
      {...rest}
      className={kitClass(
        className,
        'ck-button',
        `ck-button--${variant}`,
        `ck-button--${size}`,
        iconOnly && 'ck-button--icon',
        glow && 'ck-button--glow',
      )}
    >
      {(rp) => (
        <>
          <span className="ck-button__label">
            {typeof children === 'function' ? children(rp) : children}
          </span>
          {rp.isPending && <span className="ck-spinner" aria-hidden="true" />}
        </>
      )}
    </AriaButton>
  );
}

/** RAC Link rendered as an `<a class="ck-button">`. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  iconOnly,
  glow,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <AriaLink
      {...rest}
      className={kitClass(
        className,
        'ck-button',
        `ck-button--${variant}`,
        `ck-button--${size}`,
        iconOnly && 'ck-button--icon',
        glow && 'ck-button--glow',
      )}
    >
      {(rp) => (
        <span className="ck-button__label">
          {typeof children === 'function' ? children(rp) : children}
        </span>
      )}
    </AriaLink>
  );
}

/** Standalone busy indicator (a spinner inside a Button is handled by `isPending`). */
export function Spinner({ label }: { label?: string }) {
  return <span className="ck-spinner" role="status" aria-label={label ?? 'Loading'} />;
}
