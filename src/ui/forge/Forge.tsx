// Context Forge island root (UI_SPEC §H): Discover (left) + Context editor (right), plus the two
// app-level dialogs. Mounted by src/pages/forge.astro with client:only="react".
import { useStore } from '@nanostores/react';
import { $pendingSwitch, $yamlInvalid, cancelSwitch, confirmSwitch } from '../../stores/forge.ts';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { ContextPane } from './ContextPane.tsx';
import { DiscoverPane } from './DiscoverPane.tsx';
import { NewContextDialog } from './NewContextDialog.tsx';

/** Shown when the user switches context with a dirty or invalid draft. */
function SwitchGuard() {
  const pending = useStore($pendingSwitch);
  const invalid = useStore($yamlInvalid);
  return (
    <DiscardDialog
      isOpen={pending !== null}
      title={invalid ? 'Discard invalid YAML?' : undefined}
      message={
        invalid
          ? 'The YAML has errors and cannot be saved. Switching context discards it.'
          : 'Switching context discards the edits you have not saved.'
      }
      onConfirm={confirmSwitch}
      onCancel={cancelSwitch}
      testId="forge-discard-dialog"
    />
  );
}

export default function Forge() {
  return (
    <div className="cx-forge" data-testid="forge">
      <DiscoverPane />
      <ContextPane />
      <NewContextDialog />
      <SwitchGuard />
    </div>
  );
}
