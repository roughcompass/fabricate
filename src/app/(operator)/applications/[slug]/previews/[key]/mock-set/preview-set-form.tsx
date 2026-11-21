"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, type Choice, ChoiceGroup, FormFooter, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { PreviewSetFormState } from "../../../mock-sets/form-states";

/** A saved preview's choice of mock set: the application's default, None, or a set, as a radio group. */
export function PreviewSetForm({ action, initial, choices, cancelHref }: { action: (previous: PreviewSetFormState, formData: FormData) => Promise<PreviewSetFormState>; initial: PreviewSetFormState; choices: readonly Choice[]; cancelHref: string }) {
  return (
    <ActionForm action={action} initial={initial}>
      {(state) => (
        <div className={formStyles.form}>
          <ChoiceGroup id="preview-mock-set" name="choice" legend="Mock set" type="radio" selected={[state.values.choice]} errors={state.errors.choice} choices={choices} />
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
