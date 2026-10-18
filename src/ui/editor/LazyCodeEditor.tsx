// BROWSER-ONLY (import from client:only="react" islands). The way new islands mount Monaco: the ~4 MB editor
// chunk (Monaco, its workers, monaco-yaml) is fetched only when an editor is first rendered, so detail pages
// do not download it until Edit is pressed (ROUND2_UI_SPEC D4, §C.1). Forge and Inflate keep the static
// `CodeEditor` import from the kit. Same props as `CodeEditor`. The type re-exports are erased at build time,
// so this file never pulls Monaco in statically.
import { Suspense, lazy } from 'react';
import { boxClass, initialBoxStyle } from './box.ts';
import type { CodeEditorProps } from './CodeEditor.tsx';

export type {
  CodeEditorApi,
  CodeEditorProps,
  CodeHeight,
  CodeLanguage,
  CodeMarker,
} from './CodeEditor.tsx';

const CodeEditor = lazy(() => import('./CodeEditor.tsx').then((m) => ({ default: m.CodeEditor })));

/**
 * `CodeEditor`, loaded on first render. The Suspense fallback is a `.ck-code` box with the same `testId`, the
 * same classes and the same initial height (no layout shift), so tests can wait on `.monaco-editor` inside it.
 */
export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          className={boxClass(props)}
          data-testid={props.testId}
          data-language={props.language}
          style={initialBoxStyle(props.height)}
        >
          <div className="ck-code__loading">Loading editor…</div>
        </div>
      }
    >
      <CodeEditor {...props} />
    </Suspense>
  );
}
