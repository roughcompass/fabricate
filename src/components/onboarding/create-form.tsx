"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, FormSection, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { ActorField } from "./draft-form";
import type { DialogAction, DialogState } from "./form-dialog";

const value = (state: DialogState, field: string) => {
  const entry = state.values[field];
  return typeof entry === "string" ? entry : "";
};

/**
 * Creates a Portal, Web Application, or MFE: its name, owning team, and
 * optional SEAL ID, which other records may share, and the name of who's
 * creating it.
 */
export function CreateRecordForm({ action, noun, actor, cancelHref, nameDescription, sealDescription, ownerTeamDescription = "You can add it later in the Draft; it's needed to submit." }: { action: DialogAction; noun: string; actor: string; cancelHref: string; nameDescription: string; sealDescription: string; ownerTeamDescription?: string }) {
  const [state, formAction] = useActionState(action, { values: { actor }, errors: {} });
  const form = useFocusFirstInvalid(state, "create-alert");
  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Creating">{`Create ${noun}`}</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="create-alert">{state.errors.base.join(" ")}</FormAlert>}
          <FormSection title={noun}>
            <TextInput id="name" name="name" label="Name" defaultValue={value(state, "name")} errors={state.errors.name} description={nameDescription} maxLength={200} required />
            <TextInput id="ownerTeam" name="ownerTeam" label="Owning team" defaultValue={value(state, "ownerTeam")} errors={state.errors.ownerTeam} maxLength={200} optional description={ownerTeamDescription} />
            <TextInput id="sealId" name="sealId" label="SEAL ID" mono defaultValue={value(state, "sealId")} errors={state.errors.sealId} maxLength={64} optional description={sealDescription} />
          </FormSection>
          <FormSection title="You">
            <ActorField state={state} />
          </FormSection>
        </div>
      </Panel>
    </form>
  );
}
