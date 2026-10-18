// Monaco completion provider for ctxman links in markdown models (ROUND3_SPEC §F.2). BROWSER-ONLY (imported
// by monaco-setup.ts, which runs once per page). Triggers on `ctxman:` (target), `](` (destination), `[[`
// (whole link) and Ctrl+Space anywhere (whole link); a bare `[` never fires. Entries come from the shared
// entries cache (`loadAllEntries`). The pure decisions live in src/lib/link-insert.ts.
import type * as Monaco from 'monaco-editor';
import { datasetDef, stateLabel } from '../../datasets/registry.ts';
import { linkCompletionContext, linkFilterText, linkInsertText } from '../../lib/link-insert.ts';
import { loadAllEntries } from '../../stores/entries.ts';

type MonacoNs = typeof Monaco;

/** Monaco instances that already got the provider (a second call, e.g. an HMR re-run, must not double it). */
const registered = new WeakSet<object>();

/** True when some editor showing `model` is read-only: Ctrl+Space must not offer to insert there. */
function isReadOnly(monaco: MonacoNs, model: Monaco.editor.ITextModel): boolean {
  const shown = monaco.editor.getEditors().filter((ed) => ed.getModel() === model);
  return shown.length > 0 && shown.every((ed) => ed.getOption(monaco.editor.EditorOption.readOnly));
}

/** Register the provider for the `markdown` language. Safe to call more than once per Monaco instance. */
export function registerLinkCompletion(monaco: MonacoNs): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);

  monaco.languages.registerCompletionItemProvider('markdown', {
    triggerCharacters: [':', '(', '[', '/'],
    async provideCompletionItems(model, position, context) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      const after = line.slice(position.column - 1);
      const ctx = linkCompletionContext(before, {
        explicit: context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke,
      });
      if (ctx === null || isReadOnly(monaco, model)) return { suggestions: [] };

      const entries = await loadAllEntries();
      const range = new monaco.Range(
        position.lineNumber,
        ctx.start + 1,
        position.lineNumber,
        position.column,
      );
      return {
        suggestions: entries.map((e, i) => {
          const target = { dataset: e.dataset, slug: e.slug, title: e.title ?? e.name };
          return {
            label: { label: target.title, description: `${e.dataset}/${e.slug}` },
            kind: monaco.languages.CompletionItemKind.Reference,
            detail: datasetDef(e.dataset).label + (e.state ? ` · ${stateLabel(e.state)}` : ''),
            documentation: e.description,
            insertText: linkInsertText(ctx.kind, target, after),
            filterText: linkFilterText(ctx.kind, target),
            sortText: String(i).padStart(5, '0'),
            range,
          };
        }),
      };
    },
  });
}
