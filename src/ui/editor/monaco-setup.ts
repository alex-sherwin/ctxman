// Load Monaco from node_modules through Vite (no CDN), wire its web workers and register the
// `ctxman-cyber` theme. Import ONLY from client:only islands (touches `self` at module load; never SSR).
// Evaluated once per page: ES modules are singletons, so the worker setup and defineTheme run exactly once.
// Worker specifiers follow monaco-editor 0.57 `exports` (`./*` -> ./esm/vs/*.js), see PLAN.md §A.13.
// monaco-yaml (YAML diagnostics / hover / completion against the generated JSON Schemas) is configured here too,
// see ROUND2_BACKEND_SPEC §D.5: it needs the `createWebWorker` adapter below, the Vite alias for
// `monaco-editor/esm/vs/editor/editor.worker.js` and the `monaco-yaml*` optimizeDeps entries (astro.config.ts).
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { configureMonacoYaml } from 'monaco-yaml';
import YamlWorker from 'monaco-yaml/yaml.worker?worker';
import { CTXMAN_CYBER_THEME } from '../kit/monaco-theme.ts';
import { YAML_SCHEMAS } from './yaml-schemas.ts';

/** Name of the registered Monaco theme (pass to `<Editor theme>`). */
export const MONACO_THEME = 'ctxman-cyber';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // markdown has no language service worker: it uses the base editor worker (Monarch tokenizer). The YAML
    // language service worker is created by the createWebWorker adapter below, not through this hook.
    return label === 'json' ? new JsonWorker() : new EditorWorker();
  },
};
loader.config({ monaco });
monaco.editor.defineTheme(MONACO_THEME, CTXMAN_CYBER_THEME);

/**
 * monaco-worker-manager 2.0.1 (monaco-yaml's worker manager, unmaintained since 2022) still calls the pre-0.5x
 * `monaco.editor.createWebWorker({ moduleId, label, createData })`; monaco-editor 0.57 takes `{ worker, host,
 * keepIdleModels }`. Same steps as 0.57's internal adapter (esm/vs/internal/common/workers.js): post 'ignore',
 * then the create data. The worker (~1 MB, includes prettier) is only created for the first YAML model.
 */
interface LegacyWorkerOptions {
  createData?: unknown;
  host?: Record<string, (...args: unknown[]) => unknown>;
  keepIdleModels?: boolean;
}
const monacoForYaml = {
  ...monaco,
  editor: {
    ...monaco.editor,
    createWebWorker: (opts: LegacyWorkerOptions) => {
      const worker = new YamlWorker();
      worker.postMessage('ignore');
      worker.postMessage(opts.createData);
      return monaco.editor.createWebWorker({
        worker,
        host: opts.host,
        keepIdleModels: opts.keepIdleModels,
      });
    },
  },
} as unknown as typeof monaco;

// Schemas are bundled (no network), no formatter (Forge YAML is re-serialized, not prettified).
configureMonacoYaml(monacoForYaml, {
  enableSchemaRequest: false,
  format: { enable: false },
  schemas: YAML_SCHEMAS,
});

export { monaco };
