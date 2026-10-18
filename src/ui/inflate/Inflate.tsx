// Context Inflate island root (INFLATE_SPEC §9.3): recipe bar, Sources + Composition (compose view), the
// Preview (preview view) or the Run view (settings + dry run / progress), plus the two app-level dialogs.
// Mounted by src/pages/inflate.astro with client:only="react".
import { useStore } from '@nanostores/react';
import {
  $dirty,
  $draftRestored,
  $inflateUrl,
  $newRecipePrefill,
  $pendingSwitch,
  $recipeLoad,
  $saveStatus,
  $working,
  cancelSwitch,
  confirmSwitch,
  retryLoad,
  revert,
  selectRecipe,
} from '../../stores/inflate.ts';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { DraftNotice } from '../edit/DraftNotice.tsx';
import { Button, EmptyState, Loading, Status } from '../kit/index.ts';
import { CompositionPane } from './CompositionPane.tsx';
import { NewRecipeDialog } from './NewRecipeDialog.tsx';
import { PreviewPane } from './PreviewPane.tsx';
import { RecipeBar } from './RecipeBar.tsx';
import { RunView } from './RunView.tsx';
import { SourcesPane } from './SourcesPane.tsx';

/** "Discard unsaved changes?" shown when the user switches recipe with a dirty working copy. */
function SwitchDiscardDialog() {
  const pending = useStore($pendingSwitch);
  return (
    <DiscardDialog
      isOpen={pending !== null}
      message="Switching recipe discards the edits you have not saved."
      onConfirm={confirmSwitch}
      onCancel={cancelSwitch}
      testId="inflate-discard-dialog"
    />
  );
}

/** The working copy came back from a saved draft (a reload, a dev reload): say so, offer Discard. */
function RestoredNotice() {
  const restored = useStore($draftRestored);
  const dirty = useStore($dirty);
  if (restored === null || !dirty) return null;
  return <DraftNotice testIdPrefix="inflate" stale={restored.stale} onDiscard={revert} />;
}

/** What the body shows while no recipe is loaded (loading, not found, error, nothing selected). */
function EmptyBody() {
  const url = useStore($inflateUrl);
  const load = useStore($recipeLoad);
  const status = useStore($saveStatus);

  if (load.status === 'loading') {
    return (
      <div className="cx-inflate__empty">
        <Loading label="Loading recipe…" />
      </div>
    );
  }
  if (load.status === 'not-found' && url.recipe !== null && url.recipe !== 'new') {
    const slug = url.recipe;
    return (
      <div className="cx-inflate__empty">
        <EmptyState
          title={`No recipe named "${slug}"`}
          action={
            <Button
              variant="primary"
              onPress={() => {
                $newRecipePrefill.set(slug);
                selectRecipe('new');
              }}
            >
              Create {slug}
            </Button>
          }
        />
      </div>
    );
  }
  if (load.status === 'error') {
    return (
      <div className="cx-inflate__empty">
        <EmptyState
          title="Couldn't load this recipe"
          action={<Button onPress={retryLoad}>Retry</Button>}
        >
          {load.message}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="cx-inflate__empty">
      <EmptyState
        title="No recipe selected"
        action={
          <>
            <Button
              variant="primary"
              onPress={() => selectRecipe('new')}
              data-testid="inflate-empty-new"
            >
              New recipe
            </Button>
            {status.kind === 'deleted' && (
              <Status kind="saved" testId="inflate-status" className="cx-forge__status">
                {status.message}
              </Status>
            )}
          </>
        }
      >
        Pick a recipe or create one. A recipe lists contexts and extra items, how to include each
        one, and their order.
      </EmptyState>
    </div>
  );
}

function Body({ outDir }: { outDir: string }) {
  const working = useStore($working);
  const { view } = useStore($inflateUrl);
  if (working === null) return <EmptyBody />;
  if (view === 'preview') return <PreviewPane outDir={outDir} />;
  if (view === 'run') return <RunView />;
  return (
    <>
      <SourcesPane />
      <CompositionPane />
    </>
  );
}

export default function Inflate({ outDir }: { outDir: string }) {
  const working = useStore($working);
  const { view } = useStore($inflateUrl);
  return (
    <div className="cx-inflate" data-testid="inflate">
      <RecipeBar />
      <RestoredNotice />
      <div className="cx-inflate__body" data-view={working ? view : 'compose'}>
        <Body outDir={outDir} />
      </div>
      <NewRecipeDialog />
      <SwitchDiscardDialog />
    </div>
  );
}
