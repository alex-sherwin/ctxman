// "Output directory" panel of the Sources pane (plans/INFLATE_V2_SPEC.md §11.3): where a run places the
// material, the context file name, which stub files are generated and whether a non-empty directory is
// fine. Everything here edits the RECIPE (`output`); one-off changes for a single run live in the Run view.
import { useStore } from '@nanostores/react';
import type { RecipeData } from '../../datasets/schemas.ts';
import {
  CONTEXT_FILE_MESSAGE,
  CONTEXT_FILE_PATTERN,
  DEFAULT_CONTEXT_FILE,
  STUB_FILES,
  STUB_IDS,
  STUB_LABELS,
  defaultDirFor,
  isPortableAbsoluteDir,
  stubDefaults,
} from '../../lib/inflate/catalog.ts';
import {
  $plan,
  setAllowNonEmpty,
  setContextFile,
  setDefaultDir,
  setOutputDir,
  setStub,
} from '../../stores/inflate.ts';
import { $dirPlan, $runOverrideCount, selectView } from '../../stores/inflate-run.ts';
import { useDraftField } from '../edit/useDraftField.ts';
import { Button, Checkbox, Disclosure, Notice, TextField } from '../kit/index.ts';
import { plural } from './format.ts';

function DirField({ dir, name }: { dir: string; name: string }) {
  // What is being typed; the recipe takes every change, the field keeps the raw text while it has focus.
  const f = useDraftField(dir, setOutputDir);
  return (
    <TextField
      label="Directory"
      size="sm"
      mono
      value={f.shown}
      onChange={f.onChange}
      onBlur={f.onBlur}
      placeholder={defaultDirFor(name)}
      description="Absolute path or ~/…. Typed paths only: the browser cannot browse the server's folders."
      isInvalid={f.shown.trim() !== '' && !isPortableAbsoluteDir(f.shown)}
      errorMessage="must be absolute or start with ~/"
      inputTestId="inflate-output-dir"
    />
  );
}

function ContextFileField({ value }: { value: string }) {
  // Only valid file names reach the recipe.
  const f = useDraftField(value, setContextFile, (v) => CONTEXT_FILE_PATTERN.test(v));
  return (
    <TextField
      label="Context file"
      size="sm"
      mono
      value={f.shown}
      onChange={f.onChange}
      onBlur={f.onBlur}
      isInvalid={f.invalid}
      errorMessage={CONTEXT_FILE_MESSAGE}
      inputTestId="inflate-output-contextfile"
    />
  );
}

export function OutputPanel({ working }: { working: RecipeData }) {
  const plan = useStore($plan);
  const dirPlan = useStore($dirPlan);
  const overrides = useStore($runOverrideCount);
  const output = working.output;
  const dir = output?.dir ?? null;
  const contextFile = output?.contextFile ?? DEFAULT_CONTEXT_FILE;
  const defaults = stubDefaults(working.target);
  const askAllow =
    output?.allowNonEmpty === true ||
    (dirPlan.result?.blocking ?? []).some(
      (b) => b.code === 'dir-not-empty' || b.code === 'manifest-invalid',
    );
  const primary = plan?.primary ?? null;
  const primarySeg = plan?.segments.find((s) => s.type === 'item' && s.key === primary?.key);
  const primaryTitle = primarySeg?.type === 'item' ? primarySeg.title : primary?.key;

  return (
    <Disclosure
      title="Output directory"
      meta={dir ?? 'document only'}
      triggerTestId="inflate-output-toggle"
      defaultExpanded={dir !== null}
      className="cx-output__disclosure"
    >
      <div className="cx-output" data-testid="inflate-output">
        <DirField dir={dir ?? ''} name={working.name} />
        <div className="cx-row">
          <Button size="sm" onPress={setDefaultDir} data-testid="inflate-output-default">
            Use default
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setOutputDir(null)}
            isDisabled={dir === null}
            data-testid="inflate-output-clear"
          >
            Document only
          </Button>
        </div>
        <ContextFileField value={contextFile} />
        <fieldset className="cx-output__stubs">
          <legend className="cx-label">Generated files</legend>
          {STUB_IDS.map((id) => {
            // a stub named like the context file is never written: the context file itself is that file
            const isContext = STUB_FILES[id].toLowerCase() === contextFile.toLowerCase();
            return (
              <Checkbox
                key={id}
                isSelected={!isContext && (output?.stubs?.[id] ?? defaults[id])}
                isDisabled={isContext}
                onChange={(on) => setStub(id, on)}
                data-testid={`inflate-output-stub-${id}`}
              >
                {STUB_LABELS[id]}
              </Checkbox>
            );
          })}
          {STUB_IDS.some((id) => STUB_FILES[id].toLowerCase() === contextFile.toLowerCase()) && (
            <p className="cx-subtle" data-testid="inflate-output-stub-note">
              No {contextFile} stub is written: the context file is {contextFile} itself.
            </p>
          )}
        </fieldset>
        {askAllow && (
          <Checkbox
            isSelected={output?.allowNonEmpty === true}
            onChange={setAllowNonEmpty}
            data-testid="inflate-output-allownonempty"
          >
            Allow a non-empty directory
          </Checkbox>
        )}
        <p className="cx-output__primary" data-testid="inflate-output-primary">
          Primary:{' '}
          {primary === null ? (
            <span className="cx-subtle">none</span>
          ) : (
            <>
              <strong>{primaryTitle}</strong>
              {primary.status === 'invalid' && (
                <span className="cx-output__invalid"> ({primary.message})</span>
              )}
            </>
          )}
        </p>
        {overrides > 0 && (
          <Notice tone="warn" testId="inflate-output-overrides">
            {plural(overrides, 'run override')} not saved (Run view).
          </Notice>
        )}
        <div className="cx-row">
          <Button size="sm" onPress={() => selectView('run')} data-testid="inflate-output-run">
            Open Run view
          </Button>
        </div>
      </div>
    </Disclosure>
  );
}
