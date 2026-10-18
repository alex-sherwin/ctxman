// Node + Playwright only. @deprecated (removed in the docs/cleanup phase): the dev server no longer watches the data
// directory, so nothing reloads after a write made outside the browser; `settleAfter` just runs the writes.
// The signature is kept so the specs that call it compile unchanged.
import type { Browser } from '@playwright/test';

export async function settleAfter(
  _browser: Browser,
  _baseURL: string | undefined,
  writes: () => Promise<void>,
): Promise<void> {
  await writes();
}
