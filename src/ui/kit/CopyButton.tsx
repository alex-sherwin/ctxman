import { useRef, useState } from 'react';
import { Button, type ButtonProps } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { kitClass } from './utils.ts';

/** How long the check replaces the label (same as the SSR copy buttons in src/scripts/shell.ts). */
export const COPIED_MS = 1200;

export interface CopyButtonProps extends Omit<ButtonProps, 'onPress' | 'children'> {
  /** The text to copy; a function is read at press time. */
  text: string | (() => string);
  /** Visible label. Default "Copy". */
  label?: string;
}

/**
 * A Button (default ghost, sm, glow: the look of the SSR twin) that copies `text` and, for `COPIED_MS`, shows a centered check in place of its label (`data-copied`)
 * without changing width; a visually hidden status says "Copied". SSR twin: src/components/CopyButton.astro.
 */
export function CopyButton({
  text,
  label = 'Copy',
  variant = 'ghost',
  size = 'sm',
  glow = true,
  className,
  ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
    } catch {
      return; // clipboard unavailable (insecure context / permissions): nothing to confirm
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <>
      <Button
        {...rest}
        variant={variant}
        size={size}
        glow={glow}
        className={kitClass(className, 'ck-copy')}
        data-copied={copied ? '' : undefined}
        onPress={() => void onCopy()}
      >
        <span className="ck-copy__face">
          <span className="ck-copy__text">{label}</span>
          <Icon name="check" size={13} className="ck-copy__check" />
        </span>
      </Button>
      <span className="ck-sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}
