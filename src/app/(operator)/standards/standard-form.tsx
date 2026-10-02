"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { StandardFormState } from "./form-state";

interface StandardFormProps {
  action: (previous: StandardFormState, formData: FormData) => Promise<StandardFormState>;
  initial: StandardFormState;
  lockVersion?: number;
  submitLabel: string;
  cancelHref: string;
  /** The starter Standard the draft starts from, when one was chosen. */
  starter?: string;
}

export function StandardForm({ action, initial, lockVersion, submitLabel, cancelHref, starter }: StandardFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "standard-form-alert");

  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="standard-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          {lockVersion !== undefined && <input type="hidden" name="lockVersion" value={lockVersion} />}
          {starter !== undefined && <input type="hidden" name="starter" value={starter} />}
          <TextInput id="standard-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} required maxLength={120} />
          <TextArea
            id="standard-purpose"
            name="purpose"
            label="Purpose"
            description="What desired state this Standard describes, and for whom."
            rows={3}
            defaultValue={state.values.purpose}
            errors={state.errors.purpose}
            required
            maxLength={2000}
          />
        </div>
      </Panel>
    </form>
  );
}
