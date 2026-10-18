// "Restored unsaved changes" notice of the markdown editors (ROUND3_SPEC §G): the draft came back from
// localStorage after a reload. `stale` = the file changed on disk since the draft was started, so saving
// overwrites that newer version. Shared by DocEditor (`doc-draft-restored`) and MarkdownModal
// (`md-draft-restored`); the Forge and Inflate islands have their own twin (src/ui/forge/DraftBanner.tsx).
import { Button } from '../kit/Button.tsx';
import { restoredMessage } from './draft-restore.ts';

export interface DraftNoticeProps {
  /** `doc` | `md`: `<prefix>-draft-restored` (the notice, `data-stale` when stale) and `<prefix>-draft-discard`. */
  testIdPrefix: string;
  stale: boolean;
  onDiscard(): void;
}

export function DraftNotice({ testIdPrefix, stale, onDiscard }: DraftNoticeProps) {
  return (
    <p
      className="cx-doc__restored"
      role="status"
      data-testid={`${testIdPrefix}-draft-restored`}
      data-stale={stale || undefined}
    >
      <span>{restoredMessage(stale)}</span>{' '}
      <Button
        variant="ghost"
        size="sm"
        onPress={onDiscard}
        data-testid={`${testIdPrefix}-draft-discard`}
      >
        Discard
      </Button>
    </p>
  );
}
