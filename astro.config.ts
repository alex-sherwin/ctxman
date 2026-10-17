import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { SHIKI_CONFIG } from './src/lib/markdown-config.ts';

// Local-only SSR app. Data lives outside src/ (CTXMAN_DATA_DIR or ./data) and is read by the
// content layer + node:fs; no vite.server.fs.allow needed (nothing under data/ is imported by vite).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { host: '127.0.0.1', port: 4321 },
  devToolbar: { enabled: false },
  // Same Shiki config is used by src/lib/markdown.ts (runtime notes rendering) — keep them shared.
  markdown: { shikiConfig: SHIKI_CONFIG },
  vite: {
    // Monaco's editor chunk is ~4 MB; it is loaded only by the Forge island, locally. Silence the 500 kB warning.
    build: { chunkSizeWarningLimit: 6000 },
    // Pre-bundle client deps up front so `astro dev` never full-reloads the page mid-session
    // (and mid-e2e-test) after discovering them on first hydration.
    optimizeDeps: {
      include: [
        'react-aria-components',
        'fuse.js',
        'nanostores',
        '@nanostores/react',
        'monaco-editor',
        '@monaco-editor/react',
      ],
    },
  },
});
