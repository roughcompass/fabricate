"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, FormAlert, FormFooter, Select, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ApplicationFormState } from "./form-state";

interface ApplicationFormProps {
  action: (previous: ApplicationFormState, formData: FormData) => Promise<ApplicationFormState>;
  initial: ApplicationFormState;
  lockVersion: number;
  /** The remote's branches, the tracked one first; null when the remote couldn't be listed, which asks for the name instead. */
  branches: readonly string[] | null;
  cancelHref: string;
}

/**
 * An application's settings: its name and description, and the branch it
 * tracks (applications/catalog spec, "Applications can be edited and
 * deleted"). Its address doesn't change with its name; a new branch is built,
 * and the current build stays in use until that build succeeds.
 */
export function ApplicationForm({ action, initial, lockVersion, branches, cancelHref }: ApplicationFormProps) {
  return (
    <ActionForm action={action} initial={initial} alertId="application-form-alert" hidden={{ lockVersion }}>
      {(state) => (
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="application-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <TextInput id="application-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} maxLength={80} required description="Its address stays the same when it's renamed." />
          <TextArea id="application-description" name="description" label="Description" optional defaultValue={state.values.description} errors={state.errors.description} maxLength={280} rows={3} />
          {branches ? (
            <Select
              id="application-branch"
              name="branch"
              label="Tracked branch"
              defaultValue={state.values.branch}
              errors={state.errors.branch}
              options={branches.map((branch) => ({ value: branch, label: branch }))}
              description="A new branch is built, and the current build stays in use until that build succeeds."
            />
          ) : (
            <TextInput
              id="application-branch"
              name="branch"
              label="Tracked branch"
              mono
              defaultValue={state.values.branch}
              errors={state.errors.branch}
              description="The remote's branches couldn't be listed. Enter the branch's name; it's checked when you save."
            />
          )}
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton variant="primary" pendingLabel="Saving">
              Save changes
            </SubmitButton>
          </FormFooter>
        </div>
      )}
    </ActionForm>
  );
}
