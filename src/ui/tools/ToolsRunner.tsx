// Tools island root (UI_SPEC §I): check scripts, the New entry links and the terminal-styled output.
// Mounted by src/pages/tools.astro with client:only="react". Imports kit files directly (not the barrel)
// so the Tools bundle does not pull in Monaco.
import { useEffect } from 'react';
import type { ScriptKind } from '../../lib/scripts-allowlist.ts';
import { AddEntryForm } from './AddEntryForm.tsx';
import { OutputPanel } from './OutputPanel.tsx';
import { ScriptList } from './ScriptList.tsx';

/** The public fields of an allowlisted script (the server-side file path is not sent to the browser). */
export interface ScriptInfo {
  name: string;
  label: string;
  description: string;
  kind: ScriptKind;
}

export default function ToolsRunner({ scripts }: { scripts: readonly ScriptInfo[] }) {
  // The island renders after load, so the browser's own `#add-entry` scroll found nothing yet.
  useEffect(() => {
    if (location.hash === '#add-entry') document.getElementById('add-entry')?.scrollIntoView();
  }, []);

  return (
    <div className="cx-tools" data-testid="tools">
      <div className="cx-tools__left">
        <ScriptList scripts={scripts} />
        <AddEntryForm />
      </div>
      <OutputPanel />
    </div>
  );
}
