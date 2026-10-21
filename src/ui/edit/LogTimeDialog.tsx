// The "Log time" dialog of a time-tracked entry (task, feature, bug, rca: registry TIME_TRACKED_DATASETS), shared by
// a ListTable row (its clock button, or `t` on the hovered / focused row) and an entry or document page (the Details
// panel's clock button, or `t`: the EntryTools island). One duration field, focused when the dialog opens; Enter (or
// Add) appends it to the entry's `time` list with PATCH /api/entry/<ds>/<slug> { addTime: [duration] }, then hands
// the caller the message ("Logged PT1H on “X” (total 2h 30m)", log-time.ts): the list leaves it for the reloaded
// list (list-flash.ts), an entry page shows it in the EntryTools status line and reloads. The dialog stays pending
// until the caller closes it or the page reloads. The duration is ISO 8601 (PT1H30M; `pt45m` is upper-cased),
// checked before the request (time-input.ts) and again by the server. Monaco-free: kit parts by file.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { patchEntry } from '../entry/entry-api.ts';
import { Dialog, FormDialogFooter, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { loggedMessage, logTimeError } from './log-time.ts';
import type { LogTimeTarget } from './log-time.ts';
import { addTimeInput } from './time-input.ts';

export type { LogTimeTarget } from './log-time.ts';

const FORM_ID = 'log-time-form';

export interface LogTimeDialogProps {
  target: LogTimeTarget;
  onClose: () => void;
  /** The PATCH succeeded: what was logged, for the caller to show (it reloads the page). */
  onLogged: (message: string) => void;
}

export function LogTimeDialog({ target, onClose, onLogged }: LogTimeDialogProps) {
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
      onLogged(loggedMessage(duration, target.title, res.body.frontmatter.time));
      return; // stays pending until the caller closes it or the page reloads
    }
    setPending(false);
    setError(logTimeError(res));
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
