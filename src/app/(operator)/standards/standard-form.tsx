"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, FormAlert, FormFooter, formStyles, TextArea, TextInput } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
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
  return (
    <ActionForm action={action} initial={initial} alertId="standard-form-alert" hidden={{ lockVersion, starter }}>
      {(state) => (
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
      )}
    </ActionForm>
  );
}
