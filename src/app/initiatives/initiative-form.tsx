"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { type Choice, ChoiceGroup, ErrorSummary, FormActions, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { allMessages } from "@/lib/web/form-messages";
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

export function InitiativeForm({ action, initial, lockVersion, enabledSourceCount, sourceChoices, releaseChoices, submitLabel, cancelHref }: InitiativeFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const [mode, setMode] = useState(initial.values.selectionMode);
  // Without JavaScript every field stays visible; the server ignores source
  // selections for an all-enabled scope.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const messages = allMessages(state.errors);

  useEffect(() => {
    if (messages.length) document.getElementById("initiative-form-errors")?.focus();
  }, [state, messages.length]);

  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <ErrorSummary id="initiative-form-errors" messages={messages} />
      {lockVersion !== undefined && <input type="hidden" name="lockVersion" value={lockVersion} />}

      <TextInput id="initiative-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} required maxLength={120} />
      <TextArea
        id="initiative-objective"
        name="objective"
        label="Objective"
        optional
        defaultValue={state.values.objective}
        errors={state.errors.objective}
        hint="What this initiative is trying to learn or change. Shown with every Assessment and Evaluation."
        rows={3}
      />

      <ChoiceGroup
        id="initiative-scope"
        name="selectionMode"
        legend="Repository scope"
        type="radio"
        selected={[state.values.selectionMode]}
        errors={state.errors.selectionMode}
        hint="The scope is resolved and frozen when an Assessment starts. Later catalog edits affect only future Assessments."
        onChange={(event) => setMode(event.currentTarget.value as typeof mode)}
        choices={[
          { value: "all_enabled", label: "All enabled sources", description: `Each Assessment includes every source enabled when it starts (${enabledSourceCount} now).` },
          { value: "explicit", label: "Selected sources", description: "Each Assessment includes exactly the sources chosen below." },
        ]}
      />

      <div hidden={hydrated && mode !== "explicit"}>
        {sourceChoices.length > 0 ? (
          <ChoiceGroup
            id="initiative-sources"
            name="sourcePublicIds"
            legend="Selected sources"
            type="checkbox"
            choices={sourceChoices}
            selected={state.values.sourcePublicIds}
            errors={state.errors.sources}
            hint="A selected source that is later disabled blocks the Assessment until you enable it or remove it here."
          />
        ) : (
          <Notice tone="warning" title="No enabled sources">
            <p>
              Add or enable a source in <Link href="/sources">Sources</Link> before selecting an explicit scope.
            </p>
          </Notice>
        )}
      </div>

      {releaseChoices.length > 0 ? (
        <ChoiceGroup
          id="initiative-releases"
          name="standardReleasePublicIds"
          legend="Standard Releases"
          type="checkbox"
          choices={releaseChoices}
          selected={state.values.standardReleasePublicIds}
          errors={state.errors.standardReleases}
          hint="Optional. Each selected Release is evaluated independently; none overrides another. Only published Releases can be selected."
        />
      ) : (
        <div className={formStyles.field}>
          <span className={formStyles.label}>Standard Releases</span>
          <p className={formStyles.hint}>
            No published Releases yet. Assessments establish current state without one. Publish a Standard in the <Link href="/standards">Standard Library</Link> to
            evaluate against desired state.
          </p>
          {state.errors.standardReleases?.length ? <p className={formStyles.error}>{state.errors.standardReleases.join(" ")}</p> : null}
        </div>
      )}

      <FormActions>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </FormActions>
    </form>
  );
}

const subscribeNever = () => () => {};
