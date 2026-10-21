import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// Local-only SSR app. Data lives outside the repo (CTXMAN_DATA_DIR, required) and is read at request time with
// node:fs; there are no content collections, so no vite.server.fs.allow is needed (vite imports nothing from it).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { host: '127.0.0.1', port: 4321 },
  devToolbar: { enabled: false },
  // Host-based URL trust for the node server (prod parity): without it Astro rebuilds Request.url as
  // http://localhost:<port> and the Origin check of mutating routes refuses http://127.0.0.1:<port>.
  security: {
    allowedDomains: [
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  vite: {
    // Monaco's editor chunk is ~4 MB (+ ~1 MB yaml worker); it is loaded only by editor islands, locally.
    // Silence the 500 kB warning.
    build: {
      chunkSizeWarningLimit: 6000,
      sourcemap: false,
    },
    resolve: {
      alias: [
        {
          // monaco-worker-manager (monaco-yaml's worker) imports a pre-0.5x deep path that monaco-editor 0.57's
          // `exports` map no longer serves; point it at the public specifier (ROUND2_BACKEND_SPEC D14).
          find: /^monaco-editor\/esm\/vs\/editor\/editor\.worker\.js$/,
          replacement: 'monaco-editor/editor/editor.worker',
        },
      ],
    },
    // Pre-bundle client deps up front so `astro dev` never full-reloads the page mid-session
    // (and mid-e2e-test) after discovering them on first hydration. The `monaco-yaml > …` entries are its
    // CommonJS / nested deps: without them the yaml worker dies with `module is not defined` and Vite
    // re-optimizes (full reload) when the first YAML editor opens.
    optimizeDeps: {
      include: [
        'react-aria-components',
        'fuse.js',
        'nanostores',
        'arktype',
        '@nanostores/react',
        'monaco-editor',
        '@monaco-editor/react',
        'monaco-yaml',
        'monaco-yaml > monaco-worker-manager',
        'monaco-yaml > monaco-worker-manager/worker',
        'monaco-yaml > path-browserify',
        'monaco-yaml > @vscode/l10n',
        'monaco-yaml > vscode-languageserver-types',
        'monaco-yaml > vscode-languageserver-textdocument',
        'monaco-yaml > vscode-uri',
        'monaco-yaml > jsonc-parser',
        'monaco-yaml > prettier',
        // src/lib/jira-markup.ts (Copy as JIRA Markup), lazy-imported by islands and shell.ts
        'mdast-util-from-markdown',
        'micromark-extension-gfm',
        'mdast-util-gfm',
      ],
    },
  },
});
