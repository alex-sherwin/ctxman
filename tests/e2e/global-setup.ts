// Warm-up: on the FIRST browser connection after `astro dev` starts, Astro/Vite issue one full page
// reload (~50ms after load). Absorb it here so no spec ever interacts with a page that is about to reload.
import { chromium } from '@playwright/test';
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('baseURL missing in playwright.config.ts');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page.waitForTimeout(2000);
    // The Inflate island imports Monaco and the react-aria controls, which the dashboard never loads. Vite
    // optimises those dependencies on their first request and may reload the page: wait for the island here so
    // no test starts while that is happening (a test that hits it sees "Failed to fetch dynamically imported").
    await page.goto(new URL('/inflate', baseURL).toString());
    await page.getByTestId('inflate-recipe-select').waitFor({ state: 'visible', timeout: 60_000 });
  } finally {
    await browser.close();
  }
}
