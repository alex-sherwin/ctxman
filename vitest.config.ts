/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// getViteConfig loads astro.config.ts so tests share Astro's vite setup (React JSX transform;
// `astro:*` modules are NOT available in unit tests — keep tested modules free of astro:* imports).
// tests/unit/setup.ts pins CTXMAN_DATA_DIR to an empty temp dir (tests never see tests/data by accident).
export default getViteConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    passWithNoTests: true,
    setupFiles: ['tests/unit/setup.ts'],
  },
});
