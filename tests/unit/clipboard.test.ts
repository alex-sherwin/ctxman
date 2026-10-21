import { describe, expect, it, vi } from 'vitest';
import { writeClipboard, type ClipboardEnv } from '../../src/lib/clipboard.ts';

/** A ClipboardItem stand-in that keeps what it was given. */
class FakeItem {
  static last: Record<string, Promise<Blob>> | undefined;
  constructor(items: Record<string, Promise<Blob>>) {
    FakeItem.last = items;
  }
}

function env(
  over: { write?: () => Promise<void>; writeText?: () => Promise<void> } = {},
  item = true,
) {
  const write = vi.fn(over.write ?? (async () => {}));
  const writeText = vi.fn(over.writeText ?? (async () => {}));
  const value: ClipboardEnv = {
    clipboard: { write, writeText },
    ClipboardItem: item ? (FakeItem as unknown as ClipboardEnv['ClipboardItem']) : undefined,
  };
  return { value, write, writeText };
}

describe('writeClipboard', () => {
  it('writes a string with writeText', async () => {
    const e = env();
    expect(await writeClipboard('# Title', e.value)).toBe(true);
    expect(e.writeText).toHaveBeenCalledWith('# Title');
    expect(e.write).not.toHaveBeenCalled();
  });

  it('answers false when the browser refuses, never throws', async () => {
    const refused = async () => {
      throw new DOMException('Document is not focused', 'NotAllowedError');
    };
    expect(await writeClipboard('x', env({ writeText: refused }).value)).toBe(false);
    expect(
      await writeClipboard(Promise.resolve('x'), env({ write: refused, writeText: refused }).value),
    ).toBe(false);
  });

  it('answers false without a clipboard (the default env under Node has none)', async () => {
    expect(await writeClipboard('x', {})).toBe(false);
    expect(await writeClipboard('x')).toBe(false);
  });

  it('starts a promise write synchronously through a ClipboardItem of text/plain', async () => {
    const e = env();
    let resolve: (text: string) => void = () => {};
    const text = new Promise<string>((r) => {
      resolve = r;
    });
    const done = writeClipboard(text, e.value);
    // called in the same task as the press, before the text exists
    expect(e.write).toHaveBeenCalledTimes(1);
    resolve('h1. Title');
    expect(await done).toBe(true);
    const blob = await FakeItem.last?.['text/plain'];
    expect(blob?.type).toBe('text/plain');
    expect(await blob?.text()).toBe('h1. Title');
    expect(e.writeText).not.toHaveBeenCalled();
  });

  it('falls back to writeText with the awaited text when the ClipboardItem write is refused', async () => {
    const e = env({
      write: async () => {
        throw new TypeError('promises not supported');
      },
    });
    expect(await writeClipboard(Promise.resolve('converted'), e.value)).toBe(true);
    expect(e.writeText).toHaveBeenCalledWith('converted');
  });

  it('awaits the text and uses writeText without ClipboardItem', async () => {
    const e = env({}, false);
    expect(await writeClipboard(Promise.resolve('converted'), e.value)).toBe(true);
    expect(e.write).not.toHaveBeenCalled();
    expect(e.writeText).toHaveBeenCalledWith('converted');
  });

  it('answers false when the text fails (a converter that cannot load)', async () => {
    const failing = () => Promise.reject(new Error('chunk failed'));
    // the item's promise rejects, so does the write; the fallback awaits the same failure
    const withItem = env({
      write: async () => {
        await FakeItem.last?.['text/plain'];
      },
    });
    expect(await writeClipboard(failing(), withItem.value)).toBe(false);
    expect(withItem.writeText).not.toHaveBeenCalled();
    const withoutItem = env({}, false);
    expect(await writeClipboard(failing(), withoutItem.value)).toBe(false);
    expect(withoutItem.writeText).not.toHaveBeenCalled();
  });
});
