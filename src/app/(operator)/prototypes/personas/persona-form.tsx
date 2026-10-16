"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, FormSection, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { MAX_CONSTRAINTS, MAX_GOALS, PERSONA_FIELDS } from "@/lib/prototypes/persona-limits";
import type { PersonaFormState } from "./form-state";

interface PersonaFormProps {
  action: (previous: PersonaFormState, formData: FormData) => Promise<PersonaFormState>;
  initial: PersonaFormState;
  submitLabel: string;
}

/** A persona's fields (prototypes/personas spec, "Personas are records in the workspace"). */
export function PersonaForm({ action, initial, submitLabel }: PersonaFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "persona-form-alert");

  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href="/prototypes/personas">Cancel</ButtonLink>
            <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="persona-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <FormSection title="Who they are">
            <TextInput id="persona-name" name="name" label="Name" description="How prototypes and reviews refer to this person, such as Priya, payments approver." defaultValue={state.values.name} errors={state.errors.name} required maxLength={PERSONA_FIELDS.name} />
            <TextInput id="persona-role" name="role" label="Role" defaultValue={state.values.role} errors={state.errors.role} required maxLength={PERSONA_FIELDS.role} />
            <TextInput id="persona-organization" name="organizationType" label="Organization type" optional defaultValue={state.values.organizationType} errors={state.errors.organizationType} maxLength={PERSONA_FIELDS.organizationType} />
          </FormSection>
          <FormSection title="What they need">
            <TextArea
              id="persona-goals"
              name="goals"
              label="Goals"
              description={`One per line, up to ${MAX_GOALS}.`}
              rows={4}
              defaultValue={state.values.goals}
              errors={state.errors.goals}
              required
            />
            <TextArea id="persona-context" name="context" label="Context" description="Where and how they work." optional rows={3} defaultValue={state.values.context} errors={state.errors.context} maxLength={PERSONA_FIELDS.context} />
            <TextArea
              id="persona-constraints"
              name="constraints"
              label="Constraints"
              description={`One per line, up to ${MAX_CONSTRAINTS}, such as approval rules or the devices they use.`}
              optional
              rows={3}
              defaultValue={state.values.constraints}
              errors={state.errors.constraints}
            />
            <TextInput id="persona-distinction" name="distinction" label="How they differ from similar personas" optional defaultValue={state.values.distinction} errors={state.errors.distinction} maxLength={PERSONA_FIELDS.distinction} />
          </FormSection>
        </div>
      </Panel>
    </form>
  );
}
