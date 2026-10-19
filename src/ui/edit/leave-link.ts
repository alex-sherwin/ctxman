// Browser-only, React-free (no DOM access of its own: testable with plain objects): which click on a link would
// take the browser away from this page. An editor with unsaved text intercepts exactly those clicks and shows its
// own "Discard unsaved changes?" dialog before following the link.

/** The parts of a click event the check reads. */
export interface LinkClick {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
}

interface AnchorLike {
  href: string;
  target: string;
  hasAttribute(name: string): boolean;
}

/**
 * The absolute URL a click is about to load in this tab, or null when it leaves nothing: a handler already took the
 * click, it is not a plain left click (modifiers and the middle button open new tabs), it is not on an `a[href]`, the
 * link opens elsewhere (`target`) or downloads, or it only jumps within this page (`#hash`).
 */
export function leavingHref(click: LinkClick, currentHref: string): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  const closest = (click.target as { closest?: unknown } | null)?.closest;
  if (typeof closest !== 'function') return null;
  const anchor = closest.call(click.target, 'a[href]') as AnchorLike | null;
  if (anchor === null) return null;
  if ((anchor.target !== '' && anchor.target !== '_self') || anchor.hasAttribute('download'))
    return null;
  const to = new URL(anchor.href, currentHref);
  const from = new URL(currentHref);
  const samePage =
    to.origin === from.origin && to.pathname === from.pathname && to.search === from.search;
  if (samePage && to.hash !== '') return null;
  return to.href;
}
