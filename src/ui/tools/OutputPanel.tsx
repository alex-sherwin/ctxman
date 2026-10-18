// Terminal-styled output of the last script run (UI_SPEC §I.4). Composes cybercore's `cyber-terminal`
// classes on a container (allowed: UI_SPEC §0.1) with a decorative scanlines layer BEHIND the text.
import { useStore } from '@nanostores/react';
import { stripAnsi } from '../../lib/ansi.ts';
import { $run, clearRun } from '../../stores/tools.ts';
import { Badge } from '../kit/Badge.tsx';
import { Button, Spinner } from '../kit/Button.tsx';

async function copyAll(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard unavailable (insecure context / permissions): nothing to do
  }
}

export function OutputPanel() {
  const run = useStore($run);
  const stdout = stripAnsi(run.stdout ?? '');
  const stderr = stripAnsi(run.stderr ?? '');
  const done = run.status === 'done';
  const hasOutput = done || run.status === 'error';
  const code = run.code ?? 0;
  const clipboard = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');

  return (
    <section
      className="cx-output cyber-terminal"
      aria-labelledby="h-output"
      data-testid="tools-output"
    >
      <div className="cx-output__fx cyber-scanlines cyber-scanlines--fine" aria-hidden="true" />
      <header className="cyber-terminal__header cx-output__head">
        <span className="cyber-terminal__dot cyber-terminal__dot--red" aria-hidden="true" />
        <span className="cyber-terminal__dot cyber-terminal__dot--yellow" aria-hidden="true" />
        <span className="cyber-terminal__dot cyber-terminal__dot--green" aria-hidden="true" />
        <h2 id="h-output" className="cyber-terminal__title cx-output__title">
          Output
        </h2>
        <span role="status" className="cx-output__status" data-testid="tools-output-status">
          {run.status === 'idle' && 'Run a check to see output.'}
          {run.status === 'running' && (
            <>
              <Spinner label={`Running ${run.script}`} /> Running {run.script}…
            </>
          )}
          {done && (
            <>
              <code>{run.script}</code>{' '}
              <span data-testid="tools-exit-code">
                <Badge tone={code === 0 ? 'success' : 'danger'}>exit {code}</Badge>
              </span>{' '}
              <span className="cx-subtle">{((run.durationMs ?? 0) / 1000).toFixed(1)}s</span>
            </>
          )}
          {run.status === 'error' && (
            <>
              <Badge tone="danger">request failed</Badge> {run.error}
            </>
          )}
        </span>
        <span className="cx-output__spacer" />
        <Button
          variant="ghost"
          size="sm"
          glow
          onPress={() => void copyAll(clipboard)}
          isDisabled={!done}
          data-testid="tools-output-copy"
        >
          Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={clearRun}
          isDisabled={!hasOutput}
          data-testid="tools-output-clear"
        >
          Clear
        </Button>
      </header>
      <div className="cyber-terminal__body cx-output__body">
        {stdout && (
          <>
            <h3 className="cx-output__label">stdout</h3>
            <pre className="cx-output__pre" data-testid="tools-stdout" tabIndex={0}>
              {stdout}
            </pre>
          </>
        )}
        {stderr && (
          <>
            <h3 className="cx-output__label cx-output__label--err">stderr</h3>
            <pre
              className="cx-output__pre cx-output__pre--err"
              data-testid="tools-stderr"
              tabIndex={0}
            >
              {stderr}
            </pre>
          </>
        )}
        {done && !stdout && !stderr && <p className="cx-subtle">No output.</p>}
        {run.status === 'idle' && (
          <p className="cx-output__prompt">
            <span aria-hidden="true">&gt;</span> ready
            <span className="cx-output__cursor" aria-hidden="true" />
          </p>
        )}
      </div>
    </section>
  );
}
