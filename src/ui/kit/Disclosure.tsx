import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosurePanel,
  Heading,
  type DisclosureProps as AriaDisclosureProps,
} from 'react-aria-components';
import { Icon } from './Icon.tsx';
import { kitClass } from './utils.ts';

export interface DisclosureProps extends Omit<AriaDisclosureProps, 'children'> {
  title: ReactNode;
  /** Right-hand mono text in the trigger, e.g. a count. */
  meta?: ReactNode;
  /** Mono one-line summary shown in the trigger after `meta`, only while collapsed. */
  preview?: ReactNode;
  /** `data-testid` of the preview span. */
  previewTestId?: string;
  /** Default 3. */
  headingLevel?: 2 | 3 | 4;
  /** `data-testid` of the trigger button. */
  triggerTestId?: string;
  /** The render-prop form lets heavy children (Monaco) mount only while expanded. */
  children: ReactNode | ((rp: { isExpanded: boolean }) => ReactNode);
}

export function Disclosure({
  title,
  meta,
  preview,
  previewTestId,
  headingLevel = 3,
  triggerTestId,
  className,
  children,
  ...rest
}: DisclosureProps) {
  return (
    <AriaDisclosure {...rest} className={kitClass(className, 'ck-disclosure')}>
      {({ isExpanded }) => (
        <>
          <Heading level={headingLevel} className="ck-disclosure__heading">
            <AriaButton
              slot="trigger"
              className="ck-disclosure__trigger"
              data-testid={triggerTestId}
            >
              <span className="ck-disclosure__chevron" aria-hidden="true">
                <Icon name="chevron" size={14} />
              </span>
              {title}
              {meta != null && <span className="ck-disclosure__meta">{meta}</span>}
              {!isExpanded && preview != null && (
                <span className="ck-disclosure__preview" data-testid={previewTestId}>
                  {preview}
                </span>
              )}
            </AriaButton>
          </Heading>
          <DisclosurePanel className="ck-disclosure__panel">
            {typeof children === 'function' ? children({ isExpanded }) : children}
          </DisclosurePanel>
        </>
      )}
    </AriaDisclosure>
  );
}
