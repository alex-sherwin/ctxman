import { useEffect, useRef, useState } from 'react';
import { writeClipboard } from '../../lib/clipboard.ts';
import { Button, type ButtonProps } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { kitClass } from './utils.ts';

/** How long the check replaces the label (same as the SSR copy buttons in src/scripts/shell.ts). */
export const COPIED_MS = 1200;

/** The copied state of one Copy button, shared with whatever else copies on its behalf (`CopySplitButton`'s menu). */
export interface CopyFeedback {
  /** What the live status says while the check shows; '' when idle. */
  status: string;
  /**
   * Writes `text` (a promise goes through a `ClipboardItem`, see `writeClipboard`); when it landed, the button shows
   * its check and the status says `done` for `COPIED_MS`. A refused write changes nothing.
   */
  copy: (text: string | Promise<string>, done?: string) => Promise<void>;
}

export function useCopyFeedback(): CopyFeedback {
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(text: string | Promise<string>, done = 'Copied') {
    // clipboard unavailable (insecure context / permissions) or the text failed: nothing to confirm
    if (!(await writeClipboard(text))) return;
    setStatus(done);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(''), COPIED_MS);
  }

  return { status, copy };
}

export interface CopyButtonProps extends Omit<ButtonProps, 'onPress' | 'children'> {
  /** The text to copy; a function is read at press time. */
  text: string | (() => string);
  /** Visible label. Default "Copy". */
  label?: string;
  /** Shared copied state (`useCopyFeedback`) when something else also copies on this button's behalf. */
  feedback?: CopyFeedback;
}

/**
 * A Button (default ghost, sm, glow: the look of the SSR twin) that copies `text` and, for `COPIED_MS`, shows a centered check in place of its label (`data-copied`)
 * without changing width; a visually hidden status says "Copied". SSR twin: src/components/CopyButton.astro.
 */
export function CopyButton({
  text,
  label = 'Copy',
  feedback,
  variant = 'ghost',
  size = 'sm',
  glow = true,
  className,
  ...rest
}: CopyButtonProps) {
  const own = useCopyFeedback();
  const { status, copy } = feedback ?? own;

  return (
    <>
      <Button
        {...rest}
        variant={variant}
        size={size}
        glow={glow}
        className={kitClass(className, 'ck-copy')}
        data-copied={status === '' ? undefined : ''}
        onPress={() => void copy(typeof text === 'function' ? text() : text)}
      >
        <span className="ck-copy__face">
          <span className="ck-copy__text">{label}</span>
          <Icon name="check" size={13} className="ck-copy__check" />
        </span>
      </Button>
      <span className="ck-sr-only" role="status">
        {status}
      </span>
    </>
  );
}
