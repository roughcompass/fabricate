"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { FormAlert, FormFooter, FormSection, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tag } from "@/components/ui/tag";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { ImportFormState } from "../form-state";

interface ImportFormProps {
  action: (previous: ImportFormState, formData: FormData) => Promise<ImportFormState>;
  initial: ImportFormState;
  cancelHref: string;
  summary: readonly { term: string; value: string; mono?: boolean }[];
}

/** Names the application and imports the repository into a dev environment. */
export function ImportForm({ action, initial, cancelHref, summary }: ImportFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "import-form-alert");
  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Importing">Import application</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="import-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <TextInput id="import-name" name="name" label="Application name" defaultValue={state.values.name} errors={state.errors.name} description="Shown on the application's page and in its portal." required maxLength={80} />
          <FormSection title="Repository" description="What will be imported and where it is deployed.">
            <DescriptionList items={summary.map((item) => [item.term, item.mono ? <Tag key={item.term}>{item.value}</Tag> : item.value])} />
          </FormSection>
        </div>
      </Panel>
    </form>
  );
}
