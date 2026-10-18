// The dry run of a working-directory run (plans/INFLATE_V2_SPEC.md §11.4): every step a run would take, the
// warnings, whatever blocks it, and the Run button. The list refreshes by itself after each edit.
import { useStore } from '@nanostores/react';
import type { StepExpect } from '../../lib/inflate/material-plan.ts';
import {
  $dirPlan,
  $effectiveDir,
  $jobActive,
  $ranOnce,
  startRun,
} from '../../stores/inflate-run.ts';
import { Badge, Button, EmptyState } from '../kit/index.ts';
import { plural } from './format.ts';

const EXPECT_TONES: Record<StepExpect, 'success' | 'muted' | 'warn' | 'info' | 'danger'> = {
  create: 'success',
  keep: 'muted',
  replace: 'warn',
  update: 'info',
  remove: 'danger',
  write: 'info',
};

type PlanKind = 'idle' | 'loading' | 'ready' | 'blocked' | 'error';

export function DirPlan() {
  const plan = useStore($dirPlan);
  const dir = useStore($effectiveDir);
  const active = useStore($jobActive);
  const ranOnce = useStore($ranOnce);
  const result = dir === null ? null : plan.result;
  const blocking = result?.blocking ?? [];
  const warnings = result?.warnings ?? [];
  const steps = result?.steps ?? [];

  let kind: PlanKind;
  let text: string;
  if (dir === null || plan.status === 'idle') {
    kind = 'idle';
    text = 'Set a directory to plan a run.';
  } else if (plan.status === 'loading') {
    kind = 'loading';
    text = 'Planning…';
  } else if (plan.status === 'error') {
    kind = 'error';
    text = `Plan failed: ${plan.message ?? 'unknown error'}`;
  } else if (blocking.length > 0) {
    kind = 'blocked';
    text = `Blocked: ${blocking[0]?.message ?? 'cannot run'}`;
  } else {
    kind = 'ready';
    text = `${plural(steps.length, 'step')} · ${plural(warnings.length, 'warning')}`;
  }
  const canRun = kind === 'ready' && !active;

  return (
    <section
      className="cx-forge__pane cx-forge__pane--composition"
      aria-labelledby="inflate-dirplan-h"
      data-testid="inflate-dirplan"
    >
      <header className="cx-forge__pane-header">
        <h2 id="inflate-dirplan-h" className="cx-forge__pane-title">
          Plan
        </h2>
        <span
          className="cx-forge__status cx-dirplan__status"
          role="status"
          data-kind={kind}
          data-testid="inflate-dirplan-status"
        >
          {text}
        </span>
        <span className="cx-inflate__spacer" />
        <Button
          variant="primary"
          size="sm"
          onPress={() => void startRun()}
          isDisabled={!canRun}
          data-testid="inflate-run-start"
        >
          {ranOnce ? 'Run again' : 'Run'}
        </Button>
      </header>
      <div className="cx-forge__pane-body cx-dirplan">
        {dir === null && (
          <EmptyState title="No directory set">
            Set an output directory in the Compose view, or type one on the left for this run.
          </EmptyState>
        )}
        {blocking.length > 0 && (
          <ul className="cx-dirplan__blocking" data-testid="inflate-dirplan-blocking">
            {blocking.map((b) => (
              <li key={`${b.code}:${b.message}`} data-code={b.code}>
                {b.message}
              </li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="cx-comp__warnings" data-testid="inflate-dirplan-warnings">
            {warnings.map((w) => (
              <li key={`${w.code}:${w.key ?? ''}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
        )}
        {steps.length > 0 && (
          <ol
            className="cx-dirplan__steps"
            data-testid="inflate-dirplan-steps"
            data-stale={kind === 'loading' || kind === 'error' ? 'true' : undefined}
            data-blocked={kind === 'blocked' ? 'true' : undefined}
          >
            {steps.map((step) => (
              <li
                key={step.id}
                className="cx-dirplan__step"
                data-testid="inflate-dirplan-step"
                data-step-id={step.id}
                data-kind={step.kind}
                data-expect={step.expect}
              >
                <Badge tone={EXPECT_TONES[step.expect]} mono>
                  {step.expect}
                </Badge>
                <span className="cx-dirplan__label">{step.label}</span>
                {step.path !== '' && <code className="cx-dirplan__path">{step.path}</code>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
