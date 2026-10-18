// "Checks" panel of the Tools page (UI_SPEC §I.3): one row per `kind: 'check'` script with a Run button.
import { useStore } from '@nanostores/react';
import { $exitCodes, $run, runScript } from '../../stores/tools.ts';
import { Badge } from '../kit/Badge.tsx';
import { Button } from '../kit/Button.tsx';
import type { ScriptInfo } from './ToolsRunner.tsx';

export function ScriptList({ scripts }: { scripts: readonly ScriptInfo[] }) {
  const run = useStore($run);
  const exitCodes = useStore($exitCodes);
  const running = run.status === 'running';
  const checks = scripts.filter((s) => s.kind === 'check');
  return (
    <section className="cx-panel" aria-labelledby="h-scripts" data-testid="tools-scripts">
      <h2 className="cx-panel__title ck-label" id="h-scripts">
        Checks
      </h2>
      <ul className="cx-scripts">
        {checks.map((s) => {
          const code = exitCodes[s.name];
          return (
            <li key={s.name} className="cx-scripts__row" data-testid={`tools-script-${s.name}`}>
              <div className="cx-scripts__info">
                <code className="cx-scripts__name">{s.name}</code>
                <span className="cx-scripts__label">{s.label}</span>
                <p className="cx-subtle">{s.description}</p>
              </div>
              {code !== undefined && (
                <Badge tone={code === 0 ? 'success' : 'danger'}>exit {code}</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                onPress={() => void runScript(s.name)}
                isPending={running && run.script === s.name}
                isDisabled={running && run.script !== s.name}
                data-testid={`tools-run-${s.name}`}
                aria-label={`Run ${s.label}`}
              >
                Run
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
