// The run being watched (plans/INFLATE_V2_SPEC.md §11.4): one row per step with its status, duration and the
// tail of its output, a Cancel button while it runs, and a summary with "Open in IDE" / "Copy path" when it is
// over. The job document comes from polling `GET /api/inflate/jobs/:id` (src/stores/inflate-run.ts).
import { useStore } from '@nanostores/react';
import type { InflateJob, JobStep, StepStatus } from '../../lib/inflate/material-plan.ts';
import { $now } from '../../stores/now.ts';
import { $ide, $job, attachJob, cancelRun, closeJob, openInIde } from '../../stores/inflate-run.ts';
import { Button, CopyButton, Disclosure, Notice, Status } from '../kit/index.ts';
import type { StatusKind } from '../kit/index.ts';
import { formatDuration, plural } from './format.ts';

/** The Status colour of a job: failed / error / lost read as errors, done as ok, the rest as neutral. */
const jobKind = (s: string): StatusKind =>
  s === 'failed' || s === 'error' || s === 'lost' ? 'error' : s === 'done' ? 'ok' : 'idle';

const GLYPHS: Record<Exclude<StepStatus, 'running'>, string> = {
  pending: '○',
  ok: '✓',
  unchanged: '=',
  skipped: '–',
  failed: '✕',
  cancelled: '⊘',
};

function StepGlyph({ status }: { status: StepStatus }) {
  return (
    <span className="cx-job__glyph" role="img" aria-label={status} data-status={status}>
      {status === 'running' ? (
        <span className="ck-spinner" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{GLYPHS[status]}</span>
      )}
    </span>
  );
}

function stepNote(step: JobStep): string {
  const parts: string[] = [];
  if (step.action !== null && step.action !== 'written') parts.push(step.action);
  if (step.message !== null && step.message !== '') parts.push(step.message);
  return parts.join(' · ');
}

function StepRow({ step }: { step: JobStep }) {
  const note = stepNote(step);
  return (
    <li
      className="cx-job__step"
      data-testid="inflate-job-step"
      data-step-id={step.id}
      data-status={step.status}
    >
      <StepGlyph status={step.status} />
      <div className="cx-job__main">
        <span className="cx-job__label">{step.label}</span>
        {note !== '' && <span className="cx-job__note">{note}</span>}
        {step.tail.length > 0 && (
          <Disclosure
            title="Output"
            meta={plural(step.tail.length, 'line')}
            triggerTestId="inflate-job-step-tail"
            defaultExpanded={step.status === 'running' || step.status === 'failed'}
            className="cx-job__tail-disclosure"
          >
            <pre className="cx-job__tail">{step.tail.join('\n')}</pre>
          </Disclosure>
        )}
      </div>
      <span className="cx-job__time cx-mono">
        {step.durationMs !== null ? formatDuration(step.durationMs) : ''}
      </span>
    </li>
  );
}

/** The status line, from the job (or from why there is none). */
function statusText(state: ReturnType<typeof $job.get>, now: number): string {
  const { job } = state;
  if (state.status === 'lost') return 'This run is no longer known to the server (it restarted).';
  if (state.status === 'error')
    return `Couldn't start the run: ${state.message ?? 'unknown error'}`;
  if (job === null) return 'Loading run…';
  const total = job.steps.length;
  switch (job.status) {
    case 'queued':
      return 'Queued…';
    case 'running': {
      const running = job.steps.findIndex((s) => s.status === 'running');
      const done = job.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length;
      const at = running === -1 ? Math.min(done + 1, total) : running + 1;
      return job.cancelRequested ? 'Cancelling…' : `Running step ${at} of ${total}`;
    }
    case 'done': {
      const s = job.summary;
      return `Done in ${formatDuration(elapsed(job, now))}: ${s?.ok ?? 0} ok, ${s?.unchanged ?? 0} unchanged`;
    }
    case 'failed': {
      const failed = job.steps.filter((s) => s.status === 'failed').length;
      return failed === 0 && job.error !== null
        ? `Failed: ${job.error}`
        : `Failed: ${failed} of ${total} steps failed`;
    }
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Milliseconds a job took (or has taken so far). */
function elapsed(job: InflateJob, now: number): number {
  if (job.startedAt === null) return 0;
  const end = job.finishedAt !== null ? Date.parse(job.finishedAt) : now;
  return Math.max(0, end - Date.parse(job.startedAt));
}

function Summary({ job }: { job: InflateJob }) {
  const ide = useStore($ide);
  const counts = job.summary;
  return (
    <div className="cx-job__summary" data-testid="inflate-job-summary">
      <p className="cx-job__counts">
        <code className="cx-mono" data-testid="inflate-job-dir">
          {job.dir}
        </code>
        {counts !== null && (
          <span className="cx-subtle">
            {' '}
            · {counts.ok} ok · {counts.unchanged} unchanged · {counts.removed} removed ·{' '}
            {counts.skipped} skipped · {counts.failed} failed · {counts.cancelled} cancelled
          </span>
        )}
      </p>
      <div className="cx-row">
        {ide.available === true && (
          <Button
            size="sm"
            variant="primary"
            onPress={() => void openInIde(job.dir)}
            isPending={ide.status === 'opening'}
            data-testid="inflate-job-open-ide"
          >
            Open in IDE
          </Button>
        )}
        <CopyButton text={job.dir} label="Copy path" data-testid="inflate-job-copy-path" />
        <Button size="sm" variant="ghost" onPress={closeJob} data-testid="inflate-job-back">
          Back to plan
        </Button>
      </div>
      <Status
        kind={ide.status === 'opening' ? 'busy' : ide.status}
        testId="inflate-job-ide-status"
        className="cx-job__idestatus"
      >
        {ide.status === 'idle' || ide.status === 'opening' ? '' : (ide.message ?? '')}
      </Status>
    </div>
  );
}

export function JobProgress() {
  const state = useStore($job);
  const now = useStore($now);
  const { job } = state;
  const lost = state.status === 'lost';
  const status = lost || state.status === 'error' ? state.status : (job?.status ?? state.status);
  // A lost job is whatever was last seen of it: it is no longer running anywhere we can reach.
  const active = !lost && job !== null && (job.status === 'queued' || job.status === 'running');
  const finished = !lost && job !== null && !active;

  return (
    <section
      className="cx-forge__pane cx-forge__pane--composition"
      aria-labelledby="inflate-job-h"
      data-testid="inflate-job"
      data-status={status}
    >
      <header className="cx-forge__pane-header">
        <h2 id="inflate-job-h" className="cx-forge__pane-title ck-label">
          Run
        </h2>
        <Status
          kind={jobKind(status)}
          testId="inflate-job-status"
          className="cx-forge__status"
          attrs={{ 'data-status': status }}
        >
          {statusText(state, now)}
        </Status>
        {active && job.startedAt !== null && (
          <span className="cx-job__elapsed cx-mono cx-subtle" data-testid="inflate-job-elapsed">
            {formatDuration(elapsed(job, now))}
          </span>
        )}
        <span className="cx-inflate__spacer" />
        {active && (
          <Button
            size="sm"
            variant="danger"
            onPress={() => void cancelRun()}
            isPending={job.cancelRequested}
            data-testid="inflate-job-cancel"
          >
            Cancel
          </Button>
        )}
      </header>
      <div className="cx-forge__pane-body cx-job">
        {job === null && state.status !== 'loading' && (
          <div className="cx-job__summary">
            <div className="cx-row">
              {state.busyJobId !== undefined && (
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => attachJob(state.busyJobId ?? '')}
                  data-testid="inflate-job-attach"
                >
                  Show the running run
                </Button>
              )}
              <Button size="sm" onPress={closeJob} data-testid="inflate-job-back">
                Back to plan
              </Button>
            </div>
          </div>
        )}
        {job !== null && job.warnings.length > 0 && (
          <Notice
            tone="warn"
            role="none"
            testId="inflate-job-warnings"
            className="cx-comp__warnings"
          >
            <ul>
              {job.warnings.map((w) => (
                <li key={`${w.code}:${w.key ?? ''}:${w.message}`}>{w.message}</li>
              ))}
            </ul>
          </Notice>
        )}
        {job !== null && (
          <ol className="cx-job__steps" data-testid="inflate-job-steps">
            {job.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        )}
        {finished && <Summary job={job} />}
        {job !== null && lost && (
          <div className="cx-job__summary">
            <Button size="sm" onPress={closeJob} data-testid="inflate-job-back">
              Back to plan
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
