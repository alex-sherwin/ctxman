// Monaco-backed editor for every markdown / JSON / YAML input (UI_SPEC §B.22, amendment 11).
// BROWSER-ONLY: import only from client:only="react" islands. Never imports CSS (styles: src/ui/kit/CodeEditor.css).
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { isSchemaDatasetId } from '../../lib/schema-comment.ts';
import type { SchemaDatasetId } from '../../lib/schema-comment.ts';
import {
  BORDER_PX,
  LINE_PX,
  boxClass,
  boxLimits,
  initialBoxStyle,
  type CodeHeight,
  type CodeLanguage,
} from './box.ts';
import { MONACO_THEME } from './monaco-setup.ts';
import { yamlModelPath } from './yaml-schemas.ts';

export type { CodeHeight, CodeLanguage } from './box.ts';

export interface CodeMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface CodeEditorApi {
  focus(): void;
  revealPosition(line: number, column: number): void;
}

export interface CodeEditorProps {
  value: string;
  /** Receives Monaco's value (`''` instead of `undefined`). */
  onChange?: (value: string) => void;
  language: CodeLanguage;
  /** Default `{ mode: 'auto', minLines: 8, maxLines: 20 }`. 'fill' is a flex child that fills its parent. */
  height?: CodeHeight;
  readOnly?: boolean;
  /** Monaco `ariaLabel` (on its textarea). */
  ariaLabel: string;
  /** `data-testid` on the `.ck-code` root. */
  testId: string;
  /** Notes style: no line numbers / folding / gutter, Tab leaves the editor. */
  compact?: boolean;
  placeholder?: string;
  /** Applied with `setModelMarkers(model, 'ctxman', ...)`; monaco-yaml's own markers use owner `yaml`. */
  markers?: readonly CodeMarker[];
  /**
   * Only with `language="yaml"`: attach the dataset's generated JSON Schema (monaco-yaml diagnostics, hover,
   * completion). The model gets the path `file:///data/<ds>/<testId>-<id>.yaml`, which matches the schema's
   * `fileMatch` and lets the in-file `# yaml-language-server: $schema=../../schemas/<ds>.schema.json`
   * comment resolve. Without it the YAML model is `inmemory://…` and only syntax is validated.
   */
  schemaDataset?: SchemaDatasetId;
  /** Cmd/Ctrl+S inside the editor (a per-instance Monaco action). */
  onSave?: () => void;
  onReady?: (api: CodeEditorApi) => void;
  /** Id of external help/issue text, set as `aria-describedby` on the root. */
  describedBy?: string;
}

const FILE_EXT: Record<CodeLanguage, string> = { markdown: 'md', json: 'json', yaml: 'yaml' };

type MonacoNs = typeof import('monaco-editor');
interface Mounted {
  editor: editor.IStandaloneCodeEditor;
  monaco: MonacoNs;
}

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

function stopEscape(e: React.KeyboardEvent<HTMLDivElement>) {
  // Monaco still handles Esc (suggest/find widgets, multi-cursor); it never reaches a RAC Dialog/Modal
  // or the search widget. Leave an editor with Tab (compact) or Ctrl/Shift+M then Tab.
  if (e.key === 'Escape') e.stopPropagation();
}

export function CodeEditor({
  value,
  onChange,
  language,
  height,
  readOnly = false,
  ariaLabel,
  testId,
  compact = false,
  placeholder,
  markers,
  schemaDataset,
  onSave,
  onReady,
  describedBy,
}: CodeEditorProps) {
  const reactId = useId();
  // Unique per instance: two editors with the same testId must never share a Monaco model.
  const instanceId = `${safeSegment(testId)}-${safeSegment(reactId)}`;
  const modelPath =
    language === 'yaml' && isSchemaDatasetId(schemaDataset)
      ? yamlModelPath(schemaDataset, instanceId)
      : `inmemory://ctxman/${instanceId}.${FILE_EXT[language]}`;

  const mode = height?.mode ?? 'auto';
  const { minPx, maxPx } = boxLimits(height);

  const [mounted, setMounted] = useState<Mounted | null>(null);
  const [autoPx, setAutoPx] = useState<number | null>(null);

  // Latest callbacks for Monaco event handlers. Refs are written in an effect, never during render.
  const onSaveRef = useRef(onSave);
  const onReadyRef = useRef(onReady);
  const limitsRef = useRef({ minPx, maxPx });
  useEffect(() => {
    onSaveRef.current = onSave;
    onReadyRef.current = onReady;
    limitsRef.current = { minPx, maxPx };
  });

  const hasError = markers?.some((m) => m.severity === 'error') ?? false;

  // Sync markers (external system) whenever they change or the editor becomes ready. Never sets state.
  useEffect(() => {
    if (!mounted) return;
    const model = mounted.editor.getModel();
    if (!model) return;
    const { monaco } = mounted;
    monaco.editor.setModelMarkers(
      model,
      'ctxman',
      (markers ?? []).map((m) => ({
        startLineNumber: m.startLineNumber,
        startColumn: m.startColumn,
        endLineNumber: m.endLineNumber,
        endColumn: m.endColumn,
        message: m.message,
        severity:
          m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      })),
    );
  }, [mounted, markers]);

  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontFamily: 'Hack, monospace',
      fontLigatures: false,
      fontSize: 12,
      lineHeight: LINE_PX,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      renderLineHighlight: compact ? 'none' : 'line',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      stickyScroll: { enabled: false },
      tabSize: 2,
      insertSpaces: true,
      quickSuggestions: false,
      wordBasedSuggestions: 'off',
      autoClosingBrackets: 'never',
      autoClosingQuotes: 'never',
      unicodeHighlight: { ambiguousCharacters: false },
      padding: { top: 4, bottom: 4 },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        alwaysConsumeMouseWheel: false,
      },
      accessibilitySupport: 'auto',
      // Chromium's EditContext input has no <textarea> (the label would sit on a contenteditable div and
      // Playwright's `.monaco-editor textarea` typing from UI_SPEC §L would find nothing). The classic
      // textarea input keeps `ariaLabel` on the textarea, as the spec describes.
      editContext: false,
      ariaLabel,
      placeholder,
      readOnly,
      wordWrap: language === 'markdown' ? 'on' : 'off',
      ...(compact
        ? {
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 6,
            lineNumbersMinChars: 0,
            tabFocusMode: true,
          }
        : { lineNumbers: 'on', folding: true }),
    }),
    [ariaLabel, compact, language, placeholder, readOnly],
  );

  const handleMount: OnMount = (ed, monaco) => {
    // addAction (not addCommand): addCommand keybindings are global, so with several editors the last wins.
    ed.addAction({
      id: 'ctxman.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        onSaveRef.current?.();
      },
    });
    ed.onDidContentSizeChange(({ contentHeight }) => {
      const { minPx: lo, maxPx: hi } = limitsRef.current;
      setAutoPx(Math.min(hi, Math.max(lo, contentHeight + BORDER_PX)));
    });
    setMounted({ editor: ed, monaco });
    // Hack is lazy-loaded by the browser; re-measure once it is available so cursor/selection line up.
    void document.fonts
      ?.load('12px Hack')
      .then(() => monaco.editor.remeasureFonts())
      .catch(() => {});
    onReadyRef.current?.({
      focus: () => ed.focus(),
      revealPosition: (line, column) => {
        ed.revealPositionInCenter({ lineNumber: line, column });
        ed.setPosition({ lineNumber: line, column });
        ed.focus();
      },
    });
  };

  const style = mode === 'auto' ? { height: autoPx ?? minPx } : initialBoxStyle(height);

  return (
    <div
      className={boxClass({ language, height, compact, readOnly })}
      data-testid={testId}
      data-language={language}
      data-invalid={hasError ? '' : undefined}
      style={style}
      aria-describedby={describedBy}
      onKeyDown={stopEscape}
    >
      <Editor
        height="100%"
        width="100%"
        language={language}
        theme={MONACO_THEME}
        value={value}
        path={modelPath}
        onChange={(v) => onChange?.(v ?? '')}
        options={options}
        onMount={handleMount}
        loading={<div className="ck-code__loading">Loading editor…</div>}
      />
    </div>
  );
}
