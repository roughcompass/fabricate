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
 * Edit details (navigation spec, "A Portal's page shows its
 * details and lifecycle"): the SEAL ID, name, owning team, and description,
 * with the same rules as creation. The platform and slug are shown and
 * fixed. A save based on an older version is refused, keeping what was
 * entered.
 */
export function PortalEditForm({ action, initial, lockVersion, cancelHref, fixed }: { action: DialogAction; initial: DialogState; lockVersion: number; cancelHref: string; fixed: { platform: string | null; slug: string | null } }) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "portal-edit-alert");
  const fixedFacts = [fixed.platform && `the platform ${fixed.platform}`, fixed.slug && `the slug ${fixed.slug}`].filter(Boolean);
  const facts = fixedFacts.length > 0 ? `${fixedFacts.join(" and ")} ${fixedFacts.length > 1 ? "don't" : "doesn't"} change.` : "";
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
          {state.errors.base && <FormAlert id="portal-edit-alert">{state.errors.base.join(" ")}</FormAlert>}
          <input type="hidden" name="lockVersion" value={lockVersion} />
          {facts && <FormNote title="Fixed at creation">{`${facts.charAt(0).toUpperCase()}${facts.slice(1)}`}</FormNote>}
          <TextInput id="portal-seal-id" name="sealId" label="SEAL ID" mono defaultValue={value(state, "sealId")} errors={state.errors.sealId} required maxLength={64} description="Metadata only: other Portals, Applications, and MFEs may carry the same SEAL ID." />
          <TextInput id="portal-name" name="name" label="Name" defaultValue={value(state, "name")} errors={state.errors.name} required maxLength={100} />
          <TextInput id="portal-owner-team" name="ownerTeam" label="Owning team" defaultValue={value(state, "ownerTeam")} errors={state.errors.ownerTeam} required maxLength={100} description="The team that owns the Portal and arranges its menu." />
          <TextArea id="portal-description" name="description" label="Description" defaultValue={value(state, "description")} errors={state.errors.description} required maxLength={500} description="What the Portal is for, in a sentence or two." />
        </div>
      </Panel>
    </form>
  );
}
