// Run view of Inflate (plans/INFLATE_V2_SPEC.md §11.4): the run settings on the left, the dry run (or, once a
// run has started, its progress) on the right. Rendered inside the same two-column body as Compose.
import { useStore } from '@nanostores/react';
import { $job } from '../../stores/inflate-run.ts';
import { DirPlan } from './DirPlan.tsx';
import { JobProgress } from './JobProgress.tsx';
import { RunSettings } from './RunSettings.tsx';

export function RunView() {
  const job = useStore($job);
  return (
    <>
      <RunSettings />
      {job.status === 'idle' ? <DirPlan /> : <JobProgress />}
    </>
  );
}
