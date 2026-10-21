import { useContext } from 'react';
import { RootMenuTriggerStateContext, type Key } from 'react-aria-components';
import { Button } from './Button.tsx';
import { CopyButton, useCopyFeedback, type CopyButtonProps } from './CopyButton.tsx';
import { Icon } from './Icon.tsx';
import { Menu, MenuItem, MenuTrigger } from './Menu.tsx';
import { Popover } from './Popover.tsx';

/** One more way to copy, offered in the menu of a `CopySplitButton`. */
export interface CopyOption {
  id: string;
  /** Menu item label. */
  label: string;
  /** What the live status says after this copy (the plain Copy says "Copied"). */
  copied: string;
  /** The text to copy, read when the item is chosen; a promise is written without losing the user activation. */
  text: () => string | Promise<string>;
}

/** The menu, inside the trigger's Popover. */
function OptionsMenu({
  label,
  options,
  onAction,
  testId,
}: {
  label: string;
  options: readonly CopyOption[];
  onAction: (key: Key) => void;
  testId: (suffix: string) => string | undefined;
}) {
  // react-aria focuses the menu itself when a pointer opened it (no focus strategy): take the first item then too, like
  // a key press and the SSR twin, so the menu always opens with an item lit; ArrowUp still opens on the last one.
  const trigger = useContext(RootMenuTriggerStateContext);
  return (
    <Menu
      aria-label={label}
      autoFocus={trigger?.focusStrategy ?? 'first'}
      onAction={onAction}
      data-testid={testId('menu')}
    >
      {options.map((o) => (
        <MenuItem key={o.id} id={o.id} data-testid={testId(o.id)}>
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

export interface CopySplitButtonProps extends Omit<CopyButtonProps, 'feedback'> {
  options: readonly CopyOption[];
  /** Accessible name of the arrow and of its menu. Default "More copy options". */
  moreLabel?: string;
  /** Called when the arrow is hovered or focused and when the menu opens: start loading what the options need. */
  onPrepare?: () => void;
  /** The left part's test id; the arrow gets `<id>-more`, the menu `<id>-menu`, each item `<id>-<option id>`. */
  'data-testid'?: string;
}

/**
 * A `CopyButton` joined to a narrow arrow that opens a menu of `options` (`[ Copy | v ]`). Choosing an option copies its
 * text and confirms on the LEFT part, like a plain Copy, with the option's own status text. Converter-agnostic: the
 * caller builds the options (src/ui/markdown/MarkdownCopyButton.tsx). SSR twin: src/components/MarkdownCopyButton.astro.
 */
export function CopySplitButton({
  options,
  moreLabel = 'More copy options',
  onPrepare,
  isDisabled,
  'data-testid': testId,
  ...rest
}: CopySplitButtonProps) {
  const feedback = useCopyFeedback();
  const sub = (suffix: string) => (testId === undefined ? undefined : `${testId}-${suffix}`);

  function choose(key: Key) {
    const option = options.find((o) => o.id === key);
    // called inside the press: the clipboard write starts before any await
    if (option !== undefined) void feedback.copy(option.text(), option.copied);
  }

  return (
    <span className="ck-split">
      <CopyButton
        {...rest}
        isDisabled={isDisabled}
        feedback={feedback}
        className="ck-split__main"
        data-testid={testId}
      />
      <MenuTrigger
        onOpenChange={(open) => {
          if (open) onPrepare?.();
        }}
      >
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          isDisabled={isDisabled}
          aria-label={moreLabel}
          className="ck-split__more"
          onHoverStart={onPrepare}
          onFocus={onPrepare}
          data-testid={sub('more')}
        >
          <Icon name="chevron" className="ck-split__chevron" />
        </Button>
        <Popover placement="bottom end">
          <OptionsMenu label={moreLabel} options={options} onAction={choose} testId={sub} />
        </Popover>
      </MenuTrigger>
    </span>
  );
}
