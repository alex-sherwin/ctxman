// The Save / Cancel row + inline status shared by DocEditor, MarkdownModal and DataForm (ROUND2_UI_SPEC §C.2).
// Browser-only; imports kit parts by file (never the barrel, which pulls Monaco).
import { isMac } from '../../stores/platform.ts';
import { Button } from '../kit/Button.tsx';
import { Tooltip } from '../kit/Tooltip.tsx';
import { statusText } from './status.ts';
import type { SaveStatus } from './status.ts';

export interface SaveBarProps {
  status: SaveStatus;
  /** Save is disabled when false (nothing to save, or the draft is invalid). */
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  /** Test ids: `${p}-save`, `${p}-cancel`, `${p}-status`. */
  testIdPrefix: string;
}

export function SaveBar({
  status,
  canSave,
  onSave,
  onCancel,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  testIdPrefix,
}: SaveBarProps) {
  return (
    <div className="cx-savebar">
      <Tooltip content={isMac ? '⌘S' : 'Ctrl+S'} placement="bottom">
        <Button
          variant="primary"
          onPress={onSave}
          isDisabled={!canSave}
          isPending={status.kind === 'saving'}
          data-testid={`${testIdPrefix}-save`}
        >
          {saveLabel}
        </Button>
      </Tooltip>
      <Button variant="ghost" onPress={onCancel} data-testid={`${testIdPrefix}-cancel`}>
        {cancelLabel}
      </Button>
      <span
        className="cx-savebar__status"
        role="status"
        data-kind={status.kind}
        data-testid={`${testIdPrefix}-status`}
      >
        {statusText(status)}
      </span>
    </div>
  );
}
