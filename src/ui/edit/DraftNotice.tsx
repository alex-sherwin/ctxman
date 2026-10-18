// "Restored unsaved changes" notice of every editor that mirrors its draft to localStorage (DocEditor,
// MarkdownModal, Forge, Inflate): the draft came back after a reload. `stale` = the file changed on disk since the
// draft was started, so saving overwrites that newer version. Browser-only; kit parts imported by file.
import { restoredMessage } from '../markdown/draft-restore.ts';
import { Button } from '../kit/Button.tsx';
import { Notice } from '../kit/Notice.tsx';

export interface DraftNoticeProps {
  /** `doc` | `md` | `forge` | `inflate`: `<prefix>-draft-restored` (the notice, `data-stale` when stale) and `<prefix>-draft-discard`. */
  testIdPrefix: string;
  stale: boolean;
  onDiscard(): void;
}

export function DraftNotice({ testIdPrefix, stale, onDiscard }: DraftNoticeProps) {
  return (
    <Notice
      layout="row"
      tone={stale ? 'warn' : 'info'}
      role="status"
      testId={`${testIdPrefix}-draft-restored`}
      attrs={{ 'data-stale': stale ? 'true' : undefined }}
      actions={
        <Button
          size="sm"
          variant="secondary"
          onPress={onDiscard}
          data-testid={`${testIdPrefix}-draft-discard`}
        >
          Discard
        </Button>
      }
    >
      {restoredMessage(stale)}
    </Notice>
  );
}
