// Full-page editors (the DocEditor of okf / skill pages, the DataForm YAML view) end at the bottom of the viewport
// instead of below it: the space above the box (breadcrumbs, page header, toolbar, notices) and the content below it
// inside its column (the DataForm's save bar) are MEASURED, not guessed, and handed to CSS as `--fill-top` (document
// offset of the box) and `--fill-after`; the box's own rule turns them into a height (min-height still applies).
// Re-measured on window resize and whenever the column or the page changes size. Browser-only.
import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

export function useViewportFill(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  /** Selector of the box's column: what follows the box inside it stays on screen too. */
  column: string,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || el === null) return;
    const host = el.closest(column) ?? el;
    let frame = 0;
    const setVar = (name: string, px: number) => {
      const value = `${Math.max(0, Math.round(px))}px`;
      if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    };
    const measure = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      setVar('--fill-top', box.top + window.scrollY);
      setVar('--fill-after', host.getBoundingClientRect().bottom - box.bottom);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    // Setting the height never moves the box's top or what follows it, so a re-measure settles at once.
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    observer.observe(document.body);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      el.style.removeProperty('--fill-top');
      el.style.removeProperty('--fill-after');
    };
  }, [ref, enabled, column]);
}
