"use client";

import { useActionState, useEffect } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ErrorSummary, FormActions, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { allMessages } from "@/lib/web/form-messages";
import type { SourceFormState } from "./source-form-state";

interface SourceFormProps {
  action: (previous: SourceFormState, formData: FormData) => Promise<SourceFormState>;
  initial: SourceFormState;
  lockVersion?: number;
  submitLabel: string;
}

export function SourceForm({ action, initial, lockVersion, submitLabel }: SourceFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const messages = allMessages(state.errors);

  // Move focus to the summary after a rejected submission.
  useEffect(() => {
    if (messages.length) document.getElementById("source-form-errors")?.focus();
  }, [state, messages.length]);

  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <ErrorSummary id="source-form-errors" messages={messages} />
      {lockVersion !== undefined && <input type="hidden" name="lockVersion" value={lockVersion} />}

      <TextInput
        id="source-name"
        name="name"
        label="Name"
        defaultValue={state.values.name}
        errors={state.errors.name}
        hint="A display name. The catalog identifies sources by their canonical clone URL, not by name."
        required
        maxLength={100}
      />
      <TextInput
        id="source-clone-url"
        name="cloneUrl"
        label="Clone URL"
        mono
        inputMode="url"
        defaultValue={state.values.cloneUrl}
        errors={state.errors.cloneUrl}
        hint="file://, https://, or ssh:// only. Don't embed credentials; the worker's SSH agent or Git credential helper supplies them."
        required
      />
      <TextInput
        id="source-git-ref"
        name="gitRef"
        label="Reference"
        optional
        mono
        defaultValue={state.values.gitRef}
        errors={state.errors.gitRef}
        hint="Branch, tag, or full commit SHA. Leave blank to assess the default branch."
      />

      <FormActions>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <ButtonLink href="/sources" variant="ghost">
          Cancel
        </ButtonLink>
      </FormActions>
    </form>
  );
}
