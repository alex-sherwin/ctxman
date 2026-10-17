// Load Monaco from node_modules through Vite (no CDN), wire its web workers and register the
// `ctxman-cyber` theme. Import ONLY from client:only islands (touches `self` at module load; never SSR).
// Evaluated once per page: ES modules are singletons, so the worker setup and defineTheme run exactly once.
// Worker specifiers follow monaco-editor 0.57 `exports` (`./*` -> ./esm/vs/*.js), see PLAN.md §A.13.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { CTXMAN_CYBER_THEME } from '../kit/monaco-theme.ts';

/** Name of the registered Monaco theme (pass to `<Editor theme>`). */
export const MONACO_THEME = 'ctxman-cyber';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // markdown and yaml have no language service worker: they use the base editor worker (Monarch tokenizers)
    return label === 'json' ? new JsonWorker() : new EditorWorker();
  },
};
loader.config({ monaco });
monaco.editor.defineTheme(MONACO_THEME, CTXMAN_CYBER_THEME);

export { monaco };
