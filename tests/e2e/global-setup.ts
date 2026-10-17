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
  } finally {
    await browser.close();
  }
}
