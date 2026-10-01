"use client";

import Link from "next/link";
import { useActionState, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { type Choice, ChoiceGroup, FormAlert, FormFooter, FormSection, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { InitiativeFormState } from "./form-state";

interface InitiativeFormProps {
  action: (previous: InitiativeFormState, formData: FormData) => Promise<InitiativeFormState>;
  initial: InitiativeFormState;
  lockVersion?: number;
  enabledSourceCount: number;
  sourceChoices: Choice[];
  releaseChoices: Choice[];
  submitLabel: string;
  cancelHref: string;
}

const subscribeNever = () => () => {};

export function InitiativeForm({ action, initial, lockVersion, enabledSourceCount, sourceChoices, releaseChoices, submitLabel, cancelHref }: InitiativeFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "initiative-form-alert");
  const [mode, setMode] = useState(initial.values.selectionMode);
  // Without JavaScript every field stays visible; the server ignores source
  // selections for an all-enabled scope.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  return (
    <form ref={form} action={formAction} noValidate>
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
          {lockVersion !== undefined && <input type="hidden" name="lockVersion" value={lockVersion} />}

          <FormSection title="Initiative">
            <TextInput id="initiative-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} required maxLength={120} />
            <TextArea
              id="initiative-objective"
              name="objective"
              label="Objective"
              optional
              defaultValue={state.values.objective}
              errors={state.errors.objective}
              description="What this Initiative is trying to learn or change; shown with every Assessment and Evaluation."
              rows={3}
            />
          </FormSection>

          <FormSection title="Repositories" description="The scope is resolved and frozen when an Assessment starts.">
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
                { value: "all_enabled", label: "All enabled Sources", description: `Every Source enabled when an Assessment starts (${enabledSourceCount} now).` },
                { value: "explicit", label: "Selected Sources", description: "Exactly the Sources chosen below." },
              ]}
            />
            <div hidden={hydrated && mode !== "explicit"}>
              <ChoiceGroup
                id="initiative-sources"
                name="sourcePublicIds"
                legend="Selected Sources"
                type="checkbox"
                choices={sourceChoices}
                selected={state.values.sourcePublicIds}
                errors={state.errors.sources}
                description={
                  sourceChoices.length ? (
                    "A selected Source that is later disabled blocks Assessments until it is enabled or removed here."
                  ) : (
                    <>
                      No Source is enabled. <Link href="/sources">Add or enable a Source</Link> to choose it here.
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
    </form>
  );
}
