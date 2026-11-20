"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, FormAlert, FormFooter, Select, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import type { NewPreviewFormState } from "./form-state";

type Option = { value: string; label: string } | { label: string; options: { value: string; label: string }[] };

/**
 * New preview's form: the branch or tag choice, as preview mode lists it,
 * with how many more previews the application can keep once five or fewer
 * remain; Cancel and Create preview in its footer. It works without
 * JavaScript.
 */
export function NewPreviewForm({ action, options, defaultRef, remaining, cancelHref }: { action: (previous: NewPreviewFormState, formData: FormData) => Promise<NewPreviewFormState>; options: Option[]; defaultRef: string; remaining: string | null; cancelHref: string }) {
  return (
    <ActionForm action={action} initial={{ values: { ref: defaultRef }, errors: {} }} alertId="new-preview-alert">
      {(state) => (
        <Panel
          footer={
            <FormFooter>
              <ButtonLink href={cancelHref}>Cancel</ButtonLink>
              <SubmitButton pendingLabel="Creating">Create preview</SubmitButton>
            </FormFooter>
          }
        >
          <div className={formStyles.form}>
            {state.errors.base && <FormAlert id="new-preview-alert">{state.errors.base.join(" ")}</FormAlert>}
            <Select
              id="new-preview-ref"
              name="ref"
              label="Branch or tag"
              defaultValue={state.values.ref}
              errors={state.errors.ref}
              options={options}
              description={["Its head is built now, and a branch is built again each time it moves.", remaining].filter(Boolean).join(" ")}
            />
          </div>
        </Panel>
      )}
    </ActionForm>
  );
}
