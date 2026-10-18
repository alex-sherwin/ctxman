// "Restored unsaved changes" notice shared by the Forge and Inflate islands (ROUND3_SPEC §G): the working copy
// came back from localStorage after a reload. `stale` = the file changed on disk since the draft was started, so
// saving overwrites that newer version. Discard drops the draft (the stores pass `revert`). The markdown editors
// have a twin with other markup and styling (src/ui/markdown/DraftNotice.tsx); the message text is shared.
import { Button } from '../kit/Button.tsx';
import { restoredMessage } from '../markdown/draft-restore.ts';

export interface DraftBannerProps {
  /** `forge` | `inflate`: `<prefix>-draft-restored` (the banner, `data-stale`) and `<prefix>-draft-discard`. */
  testIdPrefix: string;
  stale: boolean;
  onDiscard(): void;
}

export function DraftBanner({ testIdPrefix, stale, onDiscard }: DraftBannerProps) {
  return (
    <div
      className="cx-draftbanner"
      role="status"
      data-testid={`${testIdPrefix}-draft-restored`}
      data-stale={stale || undefined}
    >
      <span className="cx-draftbanner__text">{restoredMessage(stale)}</span>
      <Button
        size="sm"
        variant="secondary"
        onPress={onDiscard}
        data-testid={`${testIdPrefix}-draft-discard`}
      >
        Discard
      </Button>
    </div>
  );
}
