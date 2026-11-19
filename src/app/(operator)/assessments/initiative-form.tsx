"use client";

import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm, type Choice, ChoiceGroup, FormAlert, FormFooter, FormSection, formStyles, TextArea, TextInput } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { InitiativeFormState } from "./form-state";

interface InitiativeFormProps {
  action: (previous: InitiativeFormState, formData: FormData) => Promise<InitiativeFormState>;
  initial: InitiativeFormState;
  lockVersion?: number;
  sourceCount: number;
  sourceChoices: Choice[];
  releaseChoices: Choice[];
  submitLabel: string;
  cancelHref: string;
}

export function InitiativeForm({ action, initial, lockVersion, sourceCount, sourceChoices, releaseChoices, submitLabel, cancelHref }: InitiativeFormProps) {
  const [mode, setMode] = useState(initial.values.selectionMode);
  // Without JavaScript every field stays visible; the server ignores source
  // selections for a scope of all Repositories.
  const hydrated = useHydrated();

  return (
    <ActionForm action={action} initial={initial} alertId="initiative-form-alert" hidden={{ lockVersion }}>
      {(state) => (
        <Panel
          footer={
            <FormFooter>
              <ButtonLink href={cancelHref}>Cancel</ButtonLink>
              <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
            </FormFooter>
          }
        >
          <div className={formStyles.form}>
            {state.errors.base && <FormAlert id="initiative-form-alert">{state.errors.base.join(" ")}</FormAlert>}

            <FormSection title="Assessment">
              <TextInput id="initiative-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} required maxLength={120} />
              <TextArea
                id="initiative-objective"
                name="objective"
                label="Objective"
                optional
                defaultValue={state.values.objective}
                errors={state.errors.objective}
                description="What this Assessment is trying to learn or change; shown with every Run and Evaluation."
                rows={3}
              />
            </FormSection>

            <FormSection title="Repositories" description="The scope is resolved and frozen when a Run starts.">
              <ChoiceGroup
                id="initiative-scope"
                name="selectionMode"
                legend="Repository scope"
                type="radio"
                columns
                selected={[state.values.selectionMode]}
                errors={state.errors.selectionMode}
                onChange={(event) => setMode(event.currentTarget.value as typeof mode)}
                choices={[
                  { value: "all", label: "All Repositories", description: `Every Repository registered when a Run starts (${sourceCount} now).` },
                  { value: "explicit", label: "Selected Repositories", description: "Exactly the Repositories chosen below." },
                ]}
              />
              <div hidden={hydrated && mode !== "explicit"}>
                <ChoiceGroup
                  id="initiative-sources"
                  name="sourcePublicIds"
                  legend="Selected Repositories"
                  type="checkbox"
                  choices={sourceChoices}
                  selected={state.values.sourcePublicIds}
                  errors={state.errors.sources}
                  description={
                    sourceChoices.length ? undefined : (
                      <>
                        There are no Repositories yet. <Link href="/repositories/new">Add a Repository</Link> to choose it here.
                      </>
                    )
                  }
                />
              </div>
            </FormSection>

            <FormSection title="Evaluation" description="Each selected Release is evaluated independently; none overrides another.">
              <ChoiceGroup
                id="initiative-releases"
                name="standardReleasePublicIds"
                legend="Standard Releases"
                type="checkbox"
                optional
                choices={releaseChoices}
                selected={state.values.standardReleasePublicIds}
                errors={state.errors.standardReleases}
                description={
                  releaseChoices.length ? (
                    "Only published Releases can be selected."
                  ) : (
                    <>
                      No Release is published yet. Publish a Standard in the <Link href="/standards">Standard Library</Link> to evaluate against it.
                    </>
                  )
                }
              />
            </FormSection>
          </div>
        </Panel>
      )}
    </ActionForm>
  );
}
