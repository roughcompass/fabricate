"use client";

import { ActorField } from "./draft-form";
import { type DialogAction, DialogForm } from "./form-dialog";

/** Submitting the reviewed Draft: who's submitting, then Submit. */
export function SubmitForm({ action, actor, lockVersion, number, blocking, cancelHref }: { action: DialogAction; actor: string; lockVersion: number; number: number; blocking: number; cancelHref: string }) {
  return (
    <DialogForm
      id="submit"
      action={action}
      initial={{ values: { actor }, errors: {} }}
      fields={{ lockVersion: String(lockVersion) }}
      title={`Submit revision ${number}`}
      description={blocking > 0 ? `${blocking} blocking ${blocking === 1 ? "issue stops" : "issues stop"} submission. Fix ${blocking === 1 ? "it" : "them"} first.` : "Submitting freezes this revision. Later edits start a new Draft."}
      confirmLabel={`Submit revision ${number}`}
      cancelHref={cancelHref}
    >
      {(state) => <ActorField state={state} id="submit-actor" />}
    </DialogForm>
  );
}
