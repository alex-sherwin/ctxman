// The YAML editors' problem list: "✓ Valid", or a badge + one button per problem that reveals its position in
// the editor. Extracted from the Forge's YamlView so the DataForm shares it (ROUND2_UI_SPEC §C.2).
// Browser-only; kit parts imported by file.
import { Badge } from '../kit/Badge.tsx';
import { Button } from '../kit/Button.tsx';

/** The slice of `YamlIssue` (src/lib/context-yaml.ts) the list needs; 1-based like Monaco. */
export interface YamlIssueItem {
  line: number;
  column: number;
  message: string;
}

export interface YamlIssuesProps {
  /** Empty = valid. */
  issues: readonly YamlIssueItem[];
  /** Move the editor cursor there (`CodeEditorApi.revealPosition`). */
  onReveal: (line: number, column: number) => void;
  /** Test ids: `${p}-yaml-issues` (the live region), `${p}-yaml-issue` (each problem's button). */
  testIdPrefix: string;
}

export function YamlIssues({ issues, onReveal, testIdPrefix }: YamlIssuesProps) {
  return (
    <div
      className="cx-yamlissues"
      role="status"
      aria-live="polite"
      data-testid={`${testIdPrefix}-yaml-issues`}
    >
      {issues.length === 0 ? (
        <span className="cx-yamlissues__ok">✓ Valid</span>
      ) : (
        <>
          <Badge tone="danger">invalid</Badge>{' '}
          <span>
            {issues.length} problem{issues.length === 1 ? '' : 's'}
          </span>
          <ul>
            {issues.map((issue, i) => (
              <li key={`${i}:${issue.line}:${issue.column}:${issue.message}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => onReveal(issue.line, issue.column)}
                  data-testid={`${testIdPrefix}-yaml-issue`}
                >
                  <code>
                    {issue.line}:{issue.column}
                  </code>{' '}
                  {issue.message}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
