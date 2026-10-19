import { describe, expect, it } from 'vitest';
import { leavingHref } from '../../src/ui/edit/leave-link.ts';
import type { LinkClick } from '../../src/ui/edit/leave-link.ts';

const HERE = 'http://127.0.0.1:4321/kb/ctxman?edit=1';

/** A click on an element inside `<a href={href} target={target} download?>` (null `href`: no link around it). */
function click(
  href: string | null,
  over: Partial<LinkClick> = {},
  anchor: { target?: string; download?: boolean } = {},
): LinkClick {
  const a =
    href === null
      ? null
      : {
          href: new URL(href, HERE).href,
          target: anchor.target ?? '',
          hasAttribute: (name: string) => name === 'download' && anchor.download === true,
        };
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: { closest: (selector: string) => (selector === 'a[href]' ? a : null) },
    ...over,
  };
}

describe('leavingHref', () => {
  it('is the absolute URL of a plain click on a link to another page', () => {
    expect(leavingHref(click('/task'), HERE)).toBe('http://127.0.0.1:4321/task');
    expect(leavingHref(click('/kb/ctxman'), HERE)).toBe('http://127.0.0.1:4321/kb/ctxman');
    expect(leavingHref(click('https://example.com/x'), HERE)).toBe('https://example.com/x');
  });

  it('is null for clicks that leave nothing', () => {
    expect(leavingHref(click(null), HERE)).toBeNull();
    expect(leavingHref(click('/task', { defaultPrevented: true }), HERE)).toBeNull();
    expect(leavingHref(click('/task', { button: 1 }), HERE)).toBeNull();
    for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      expect(leavingHref(click('/task', { [mod]: true }), HERE), mod).toBeNull();
    }
    expect(leavingHref(click('/task', {}, { target: '_blank' }), HERE)).toBeNull();
    expect(leavingHref(click('/task', {}, { download: true }), HERE)).toBeNull();
    expect(leavingHref(click('#concepts'), HERE)).toBeNull();
    expect(leavingHref({ ...click('/task'), target: null }, HERE)).toBeNull();
  });

  it('a link to this page with another query or a _self target still leaves', () => {
    expect(leavingHref(click('/kb/ctxman'), HERE)).not.toBeNull();
    expect(leavingHref(click('/task', {}, { target: '_self' }), HERE)).toBe(
      'http://127.0.0.1:4321/task',
    );
  });
});
