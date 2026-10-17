import type { ReactElement, ReactNode } from 'react';
import { OverlayArrow, Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';

export interface TooltipProps {
  content: ReactNode;
  /** A focusable RAC trigger (Button, Link, ...). */
  children: ReactElement;
  /** Default 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Hover delay in ms. Default 500. Keyboard focus shows it instantly. */
  delay?: number;
  isDisabled?: boolean;
}

/** Supplementary only: icon buttons still need their own `aria-label`. */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 500,
  isDisabled,
}: TooltipProps) {
  return (
    <TooltipTrigger delay={delay} isDisabled={isDisabled}>
      {children}
      <AriaTooltip className="ck-tooltip" placement={placement} offset={6}>
        <OverlayArrow className="ck-tooltip__arrow">
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
