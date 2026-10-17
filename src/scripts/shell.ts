// Vanilla shell behaviour loaded by Base.astro on every page (UI_SPEC §C.1). No framework, no state:
// everything is event delegation on `document`, so it also covers markup swapped in later.

const MAC = /Mac|iPhone|iPad/;
const COPIED_MS = 1200;
/** How long the search island gets to react to `ctxman:search-open` before we fall back to the link. */
const SEARCH_FALLBACK_MS = 300;

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

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

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
