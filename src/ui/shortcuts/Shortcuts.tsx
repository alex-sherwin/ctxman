import { useEffect, useState } from 'react';
import {
  EDIT_LINK_SELECTOR,
  EDIT_SHORTCUT_EVENT,
  IDE_BUTTON_SELECTOR,
  SHORTCUTS,
  isTypingTarget,
  shortcutAction,
} from '../../lib/shortcuts.ts';
import { isMac, modKeyLabel } from '../../stores/platform.ts';
// Kit parts are imported BY FILE: the kit barrel pulls in Monaco.
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { Kbd } from '../kit/Kbd.tsx';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

function keyLabel(key: string): string {
  if (key === 'Mod') return modKeyLabel;
  if (key === 'Alt') return isMac ? '⌥' : 'Alt';
  return key;
}

/**
 * Global keyboard shortcuts (`?` help, `c` create, `l` add link, `.` IDE, `e` edit) and their help dialog. Mounted
 * once in Base.astro as `<Shortcuts client:only="react" />`. The page context comes from `<body data-shortcut-create
 * data-shortcut-link data-shortcut-edit>`; the decision is the pure `shortcutAction`. The window listener is
 * registered in the CAPTURE phase, like the search store's.
 */
export function Shortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const body = document.body;
      const target = e.target instanceof Element ? e.target : null;
      const action = shortcutAction(e, {
        createHref: body.getAttribute('data-shortcut-create'),
        linkShortcut: body.hasAttribute('data-shortcut-link'),
        ideShortcut: document.querySelector(IDE_BUTTON_SELECTOR) !== null,
        editShortcut: body.hasAttribute('data-shortcut-edit'),
        typing: isTypingTarget(target),
        dialogOpen: document.querySelector(DIALOG_SELECTOR) !== null,
      });
      if (action === null) return;
      e.preventDefault();
      if (action.kind === 'help') setOpen(true);
      else if (action.kind === 'navigate') location.assign(action.href);
      else if (action.kind === 'edit') {
        // The DocEditor takes it (preventDefault); otherwise the page's Edit link goes to `?edit=1`.
        const taken = !window.dispatchEvent(
          new CustomEvent(EDIT_SHORTCUT_EVENT, { cancelable: true }),
        );
        if (!taken) document.querySelector<HTMLElement>(EDIT_LINK_SELECTOR)?.click();
      } else document.querySelector<HTMLElement>(action.selector)?.click();
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      const trigger =
        e.target instanceof Element ? e.target.closest('[data-shortcuts-open]') : null;
      if (trigger === null) return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick);
    document.body.setAttribute('data-shortcuts-ready', '');
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick);
      document.body.removeAttribute('data-shortcuts-ready');
    };
  }, []);

  return (
    <Modal
      isOpen={open}
      onOpenChange={setOpen}
      isDismissable
      className="cx-shortcuts"
      testId="shortcuts-dialog"
    >
      <Dialog title="Keyboard shortcuts">
        <ul className="cx-shortcuts__list">
          {SHORTCUTS.map((s) => (
            <li
              key={s.id}
              className="cx-shortcuts__row"
              data-testid="shortcut-row"
              data-shortcut={s.id}
            >
              <span className="cx-shortcuts__keys">
                {s.keys.map((k) => (
                  <Kbd key={k}>{keyLabel(k)}</Kbd>
                ))}
              </span>
              <span>{s.label}</span>
              <span className="cx-shortcuts__where cx-subtle">{s.where}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </Modal>
  );
}
