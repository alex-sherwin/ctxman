// PURE (no fs; browser-safe, no DOM of its own: the clipboard comes from `globalThis` or the caller): the one clipboard
// write of every Copy button, the kit `CopyButton` family (src/ui/kit) and the SSR copy buttons (src/scripts/shell.ts).

/** The parts of the browser the write uses; a test passes its own. */
export interface ClipboardEnv {
  clipboard?: Pick<Clipboard, 'write' | 'writeText'> | undefined;
  ClipboardItem?: (new (items: Record<string, Promise<Blob>>) => ClipboardItem) | undefined;
}

function browserEnv(): ClipboardEnv {
  return {
    clipboard: globalThis.navigator?.clipboard,
    ClipboardItem: 'ClipboardItem' in globalThis ? globalThis.ClipboardItem : undefined,
  };
}

/**
 * Writes `text` to the clipboard; resolves true when it landed, false when the browser refused (insecure context,
 * permission, a failed conversion), never rejects. A string goes through `writeText`. A promise (text that is still
 * being produced, e.g. by a lazily loaded converter) goes through a `ClipboardItem` whose `text/plain` is that promise:
 * the write starts synchronously, inside the user's click or key press, so a browser that drops the user activation
 * across an `await` (Safari) still accepts it. Without `ClipboardItem`, or when the engine refuses that write, it awaits
 * the text and falls back to `writeText`.
 */
export async function writeClipboard(
  text: string | Promise<string>,
  env: ClipboardEnv = browserEnv(),
): Promise<boolean> {
  const { clipboard, ClipboardItem: Item } = env;
  if (clipboard === undefined) return false;
  try {
    if (typeof text === 'string') {
      await clipboard.writeText(text);
      return true;
    }
    if (Item !== undefined && typeof clipboard.write === 'function') {
      // no `await` before this call: it must run in the same task as the press
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      try {
        await clipboard.write([new Item({ 'text/plain': blob })]);
        return true;
      } catch {
        // refused (an engine without promise items, a failed conversion): the fallback below decides
      }
    }
    await clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}
