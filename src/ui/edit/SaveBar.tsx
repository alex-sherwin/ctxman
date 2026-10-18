// The Save / Cancel row + inline status shared by DocEditor, MarkdownModal and DataForm (ROUND2_UI_SPEC §C.2).
// Browser-only; imports kit parts by file (never the barrel, which pulls Monaco).
import { isMac } from '../../stores/platform.ts';
import { Button } from '../kit/Button.tsx';
import { Status } from '../kit/Status.tsx';
import { Tooltip } from '../kit/Tooltip.tsx';
import { cx } from '../kit/utils.ts';
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
  /** Footer layout: the status sits left, the buttons right. */
  statusFirst?: boolean;
}

export function SaveBar({
  status,
  canSave,
  onSave,
  onCancel,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  testIdPrefix,
  statusFirst,
}: SaveBarProps) {
  return (
    <div className={cx('cx-savebar', statusFirst && 'cx-savebar--status-first')}>
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
      <Button variant="secondary" onPress={onCancel} data-testid={`${testIdPrefix}-cancel`}>
        {cancelLabel}
      </Button>
      <Status kind={status.kind} testId={`${testIdPrefix}-status`}>
        {statusText(status)}
      </Status>
    </div>
  );
}
