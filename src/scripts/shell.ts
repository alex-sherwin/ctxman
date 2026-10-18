// Vanilla shell behaviour loaded by Base.astro on every page (UI_SPEC §C.1). No framework, no state:
// everything is event delegation on `document`, so it also covers markup swapped in later.

const MAC = /Mac|iPhone|iPad/;
const COPIED_MS = 1200;
/** How long the search island gets to react to `ctxman:search-open` before we fall back to the link. */
const SEARCH_FALLBACK_MS = 300;
/** How long "Opened in VS Code" stays in the IDE status line. */
const IDE_OK_MS = 4000;
/** How long "Saved" stays next to a state select. */
const STATE_SAVED_MS = 4000;
/** How long a state select's error message stays. */
const STATE_ERROR_MS = 8000;
/** `pnpm start` has no file watcher: the page reloads itself this long after a saved state. (`astro dev` reloads it, see below.) */
const STATE_RELOAD_FALLBACK_MS = 2000;
/** sessionStorage prefix of the status an entry page shows after a reload (src/ui/edit/last-save.ts + entry/after-write.ts). */
const SAVED_PREFIX = 'ctxman:saved:entry:';
const IDE_NOT_FOUND =
  "VS Code `code` command not found — install it from VS Code: Shell Command: Install 'code' command in PATH";

// 1. Modifier key label: "Ctrl" in the markup, the command symbol on Apple platforms
//    (same test as src/stores/platform.ts).
if (MAC.test(navigator.platform || navigator.userAgent)) {
  for (const el of document.querySelectorAll('[data-kbd-mod]')) el.textContent = '⌘';
}

// 2. Copy buttons: <button data-copy="text">. The label swaps to "Copied" for a moment.
const copyTimers = new WeakMap<HTMLElement, number>();

async function copyFrom(button: HTMLElement): Promise<void> {
  const text = button.dataset.copy ?? '';
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return; // clipboard unavailable (insecure context / permission): leave the button untouched
  }
  const label = button.querySelector<HTMLElement>('.ck-button__label') ?? button;
  if (!copyTimers.has(button)) button.dataset.label = label.textContent ?? '';
  window.clearTimeout(copyTimers.get(button));
  button.dataset.copied = '';
  label.textContent = 'Copied';
  copyTimers.set(
    button,
    window.setTimeout(() => {
      label.textContent = button.dataset.label ?? '';
      delete button.dataset.copied;
      delete button.dataset.label;
      copyTimers.delete(button);
    }, COPIED_MS),
  );
}

// 3. Search trigger: <a data-search-trigger href="…?search=1">. A plain click opens the search island
//    through a window event; modified clicks keep their normal link behaviour. If no island answered
//    (not hydrated yet), follow the href: the island opens itself from `?search=1` on load.
function searchOpened(): boolean {
  return (
    document.querySelector('[data-testid="search-modal"], [data-testid="search-input"]') !== null
  );
}

// 4. Open in IDE: <button data-ide-open data-dataset data-slug data-path> + a [data-ide-status] sibling.
//    On load, GET /api/ide/open says whether an IDE command exists (disable the buttons when not); a click POSTs
//    { dataset, slug, path } (the server opens the entry folder plus that file) and reports the result inline.
const ideTimers = new WeakMap<HTMLElement, number>();

function ideStatusOf(button: HTMLElement): HTMLElement | null {
  return button.parentElement?.querySelector<HTMLElement>('[data-ide-status]') ?? null;
}

function setIdeStatus(button: HTMLElement, kind: 'ok' | 'error' | '', text: string): void {
  const el = ideStatusOf(button);
  if (!el) return;
  window.clearTimeout(ideTimers.get(el));
  el.textContent = text;
  if (kind === '') delete el.dataset.kind;
  else el.dataset.kind = kind;
  if (kind === 'ok') {
    ideTimers.set(
      el,
      window.setTimeout(() => setIdeStatus(button, '', ''), IDE_OK_MS),
    );
  }
}

async function openInIde(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  setIdeStatus(button, '', '');
  try {
    const response = await fetch('/api/ide/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        dataset: button.dataset.dataset,
        slug: button.dataset.slug,
        path: button.dataset.path,
      }),
    });
    if (response.ok) {
      setIdeStatus(button, 'ok', 'Opened in VS Code');
    } else if (response.status === 501) {
      setIdeStatus(button, 'error', IDE_NOT_FOUND);
    } else {
      let message = "Couldn't open the IDE";
      try {
        const body: unknown = await response.json();
        if (body !== null && typeof body === 'object' && 'message' in body) {
          const text = (body as { message: unknown }).message;
          if (typeof text === 'string' && text !== '') message = text;
        }
      } catch {
        // not JSON: keep the generic message
      }
      setIdeStatus(button, 'error', message);
    }
  } catch {
    setIdeStatus(button, 'error', "Couldn't open the IDE");
  } finally {
    button.disabled = button.dataset.ideUnavailable !== undefined;
  }
}

async function probeIde(): Promise<void> {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-ide-open]');
  if (buttons.length === 0) return;
  try {
    const response = await fetch('/api/ide/open', { headers: { accept: 'application/json' } });
    const body: unknown = response.ok ? await response.json() : null;
    const available =
      body !== null && typeof body === 'object' && (body as { available?: unknown }).available;
    if (available === false) {
      for (const button of buttons) {
        button.dataset.ideUnavailable = '';
        button.disabled = true;
        button.title = IDE_NOT_FOUND;
      }
    }
  } catch {
    // availability unknown: leave the buttons enabled, a click reports the real error
  }
}
void probeIde();

// 5. State select: <select data-state-select data-dataset data-slug data-prev> (StateSelect.astro, list rows and the
//    detail header). A change PATCHes /api/entry/<ds>/<slug> { state }; the select is disabled meanwhile. Success:
//    the wrapper's `data-state-group` follows the new state and "Saved" shows for a moment; the page is server
//    rendered, so it reloads (the dev server does that itself, a fallback covers a build without a watcher) and
//    keeps its URL, filters included. Failure: the previous value comes back and the server's message is shown.
//    EntryTools (the detail page island) disables these selects while the doc editor is open.
const stateTimers = new WeakMap<HTMLElement, number>();

function setStateStatus(
  select: HTMLSelectElement,
  kind: 'ok' | 'error' | '',
  text: string,
  ms = 0,
): void {
  const el = select.closest('.cx-statesel')?.querySelector<HTMLElement>('[data-state-status]');
  if (!el) return;
  window.clearTimeout(stateTimers.get(el));
  el.textContent = text;
  if (kind === '') delete el.dataset.kind;
  else el.dataset.kind = kind;
  if (ms > 0)
    stateTimers.set(
      el,
      window.setTimeout(() => setStateStatus(select, '', ''), ms),
    );
}

async function messageOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object' && 'message' in body) {
      const text = (body as { message: unknown }).message;
      if (typeof text === 'string' && text !== '') return text;
    }
  } catch {
    // not JSON: generic message below
  }
  return `Could not save the state (${response.status})`;
}

async function saveState(select: HTMLSelectElement): Promise<void> {
  const { dataset, slug } = select.dataset;
  const next = select.value;
  const previous = select.dataset.prev ?? '';
  if (!dataset || !slug || next === previous) return;
  select.disabled = true;
  setStateStatus(select, '', 'Saving…');
  try {
    const response = await fetch(`/api/entry/${dataset}/${slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ state: next }),
    });
    if (!response.ok) {
      select.value = previous;
      setStateStatus(select, 'error', await messageOf(response), STATE_ERROR_MS);
      return;
    }
    select.dataset.prev = next;
    const option = select.selectedOptions[0];
    const wrapper = select.closest<HTMLElement>('.cx-statesel');
    if (wrapper && option?.dataset.group) wrapper.dataset.stateGroup = option.dataset.group;
    setStateStatus(select, 'ok', 'Saved', STATE_SAVED_MS);
    if (select.dataset.remember !== undefined) {
      try {
        sessionStorage.setItem(
          `${SAVED_PREFIX}${dataset}/${slug}`,
          `State set to ${option?.textContent?.trim() ?? next}`,
        );
      } catch {
        // storage blocked: the status line after the reload is a nicety only
      }
    }
    // `astro dev` pushes a full reload ~0.7 s after the write (the file is under data/), so a second one from here
    // would only race it and lose the status line the reloaded page shows.
    if (!import.meta.env.DEV) {
      window.setTimeout(() => {
        if (!document.querySelector('[data-edit-locked]')) location.reload();
      }, STATE_RELOAD_FALLBACK_MS);
    }
  } catch {
    select.value = previous;
    setStateStatus(select, 'error', "Couldn't reach the server", STATE_ERROR_MS);
  } finally {
    select.disabled = false;
  }
}

document.addEventListener('change', (event) => {
  const select = event.target;
  if (select instanceof HTMLSelectElement && select.matches('[data-state-select]')) {
    void saveState(select);
  }
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const ide = target.closest<HTMLButtonElement>('[data-ide-open]');
  if (ide) {
    if (!ide.disabled) void openInIde(ide);
    return;
  }

  const copy = target.closest<HTMLElement>('[data-copy]');
  if (copy) {
    void copyFrom(copy);
    return;
  }

  const trigger = target.closest<HTMLAnchorElement>('[data-search-trigger]');
  if (
    trigger &&
    !event.defaultPrevented &&
    event.button === 0 &&
    !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
  ) {
    event.preventDefault();
    // The island's listener calls preventDefault() when it handles the event; only an unhandled event
    // (island not hydrated yet) arms the fallback, so a fast open + Esc cannot reload with the widget open.
    const handled = !window.dispatchEvent(
      new CustomEvent('ctxman:search-open', { cancelable: true }),
    );
    if (handled) return;
    window.setTimeout(() => {
      if (!searchOpened()) location.assign(trigger.href);
    }, SEARCH_FALLBACK_MS);
  }
});
