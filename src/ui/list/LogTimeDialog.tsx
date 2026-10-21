// "Log time" dialog of a ListTable row (task, feature, bug, rca: registry TIME_TRACKED_DATASETS). One duration
// field, focused when the dialog opens; Enter (or Add) appends it to the entry's `time` list with
// PATCH /api/entry/<ds>/<slug> { addTime: [duration] }, then the list reloads and says what was logged
// (list-flash.ts). The duration is ISO 8601 (PT1H30M; `pt45m` is upper-cased), checked before the request
// (time-input.ts) and again by the server. Monaco-free: kit parts by file.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import type { DatasetId } from '../../datasets/registry.ts';
import { formatSeconds, totalDurationSeconds } from '../../lib/iso8601.ts';
import { addTimeInput } from '../edit/time-input.ts';
import { patchEntry } from '../entry/entry-api.ts';
import { Dialog, FormDialogFooter, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { setListFlash } from './list-flash.ts';

export interface LogTimeTarget {
  dataset: DatasetId;
  slug: string;
  title: string;
}

const FORM_ID = 'log-time-form';

export function LogTimeDialog({ target, onClose }: { target: LogTimeTarget; onClose: () => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const result = addTimeInput([], text);
    const duration = result.ok ? result.values[0] : undefined;
    if (duration === undefined) {
      setProblem((!result.ok && result.problem) || 'Enter a duration, e.g. PT1H30M');
      return;
    }
    setPending(true);
    setError(null);
    const res = await patchEntry(target.dataset, target.slug, { addTime: [duration] });
    if (res.ok) {
      const time = res.body.frontmatter.time;
      const total = Array.isArray(time)
        ? totalDurationSeconds(time.filter((t): t is string => typeof t === 'string'))
        : null;
      setListFlash(
        `Logged ${duration} on “${target.title}”${total === null ? '' : ` (total ${formatSeconds(total)})`}`,
      );
      location.reload();
      return; // stays pending until the reload
    }
    setPending(false);
    setError(
      res.issues && res.issues.length > 0
        ? res.issues.map((i) => `${i.path === '' ? '' : `${i.path}: `}${i.message}`).join('; ')
        : res.message,
    );
  }

  return (
    <Modal
      isOpen
      isDismissable={!pending}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      testId="log-time-dialog"
    >
      <Dialog
        title={`Log time on “${target.title}”`}
        footer={
          <FormDialogFooter
            formId={FORM_ID}
            submitLabel="Add"
            onCancel={() => {
              if (!pending) onClose();
            }}
            isPending={pending}
            cancelTestId="log-time-cancel"
            submitTestId="log-time-submit"
          />
        }
      >
        <Form
          id={FORM_ID}
          className="cx-entrydlg__form"
          validationBehavior="aria"
          onSubmit={(e) => void onSubmit(e)}
        >
          <TextField
            label="Time spent"
            mono
            autoFocus
            isRequired
            autoComplete="off"
            spellCheck="false"
            placeholder="PT1H30M"
            value={text}
            onChange={(v) => {
              setText(v);
              setProblem(null);
              setError(null);
            }}
            isInvalid={problem !== null}
            errorMessage={problem ?? undefined}
            description="An ISO 8601 duration (PT1H30M = 1 h 30 min, PT45M, P1D); Enter adds it."
            inputTestId="log-time-input"
          />
          {error !== null && <ErrorText testId="log-time-error">{error}</ErrorText>}
        </Form>
      </Dialog>
    </Modal>
  );
}
