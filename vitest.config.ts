/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// getViteConfig loads astro.config.ts so tests share Astro's vite setup (React JSX transform,
// `astro:content` is NOT available in unit tests — keep tested modules free of astro:* imports).
export default getViteConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    passWithNoTests: true,
  },
});
