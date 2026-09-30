"use client";

import { useActionState, useEffect } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ErrorSummary, FormActions, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { allMessages } from "@/lib/web/form-messages";
import type { StandardFormState } from "./form-state";

interface StandardFormProps {
  action: (previous: StandardFormState, formData: FormData) => Promise<StandardFormState>;
  initial: StandardFormState;
  lockVersion?: number;
  submitLabel: string;
  cancelHref: string;
}

export function StandardForm({ action, initial, lockVersion, submitLabel, cancelHref }: StandardFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const messages = allMessages(state.errors);

  useEffect(() => {
    if (messages.length) document.getElementById("standard-form-errors")?.focus();
  }, [state, messages.length]);

  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <ErrorSummary id="standard-form-errors" messages={messages} />
      {lockVersion !== undefined && <input type="hidden" name="lockVersion" value={lockVersion} />}
      <TextInput id="standard-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} required maxLength={120} />
      <TextArea id="standard-purpose" name="purpose" label="Purpose" hint="What desired state this Standard describes, and for whom." rows={3} defaultValue={state.values.purpose} errors={state.errors.purpose} required maxLength={2000} />
      <FormActions>
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </FormActions>
    </form>
  );
}
