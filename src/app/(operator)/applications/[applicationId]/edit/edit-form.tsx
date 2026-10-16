"use client";

import { useActionState } from "react";
import type { DialogAction, DialogState } from "@/components/onboarding/form-dialog";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, FormNote, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";

const value = (state: DialogState, name: string) => {
  const entry = state.values[name];
  return Array.isArray(entry) ? entry[0] : entry;
};

/**
 * Edit details (application-dashboard spec, "Details can be edited in
 * place"): the name, SEAL ID, and description, with the same rules as
 * creation. The slug, repository, and Portal are shown and fixed. A save
 * based on an older version is refused, keeping what was entered.
 */
export function ApplicationEditForm({ action, initial, lockVersion, cancelHref, fixed }: { action: DialogAction; initial: DialogState; lockVersion: number; cancelHref: string; fixed: { slug: string; repository: string; portal: string } }) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "application-edit-alert");
  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="application-edit-alert">{state.errors.base.join(" ")}</FormAlert>}
          <input type="hidden" name="lockVersion" value={lockVersion} />
          <FormNote title="Fixed at creation">{`The slug ${fixed.slug}, the repository ${fixed.repository}, and the Portal ${fixed.portal} don't change.`}</FormNote>
          <TextInput id="application-seal-id" name="sealId" label="SEAL ID" mono defaultValue={value(state, "sealId")} errors={state.errors.sealId} required maxLength={64} />
          <TextInput id="application-name" name="name" label="Name" defaultValue={value(state, "name")} errors={state.errors.name} required maxLength={100} />
          <TextArea id="application-description" name="description" label="Description" defaultValue={value(state, "description")} errors={state.errors.description} required maxLength={500} />
        </div>
      </Panel>
    </form>
  );
}
