// Node + Playwright only: wait for the dev server's full-reload push after writes made outside the browser.
//
// `astro dev` reloads every connected page about 0.7 s after a file under data/ changed, and up to ~2 s when the server
// is still warming up. A spec that writes entries through the API (or the file system) and then opens a page can have
// that reload land in the middle of its first interaction (the click is swallowed, the status line is gone). A fixed
// `settleDevReload()` delay is a guess; this helper keeps a page connected to the dev server while `writes` run and
// returns once that page has been reloaded and stayed quiet for QUIET_MS, so a page opened afterwards is never hit.
import type { Browser } from '@playwright/test';

const FIRST_RELOAD_MS = 8_000;
const QUIET_MS = 1_200;
/** The Vite client opens its websocket just after `load`. */
const CONNECT_MS = 400;

export async function settleAfter(
  browser: Browser,
  baseURL: string | undefined,
  writes: () => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForTimeout(CONNECT_MS);
    let loads = 0;
    page.on('load', () => (loads += 1));
    await writes();
    const deadline = Date.now() + FIRST_RELOAD_MS;
    while (loads === 0 && Date.now() < deadline) await page.waitForTimeout(100);
    // quiet period: the reload of one write can be followed by the one of the next
    let seen = loads;
    let quietSince = Date.now();
    while (Date.now() - quietSince < QUIET_MS) {
      await page.waitForTimeout(100);
      if (loads !== seen) {
        seen = loads;
        quietSince = Date.now();
      }
    }
  } finally {
    await context.close();
  }
}
