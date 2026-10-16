"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { type Choice, ChoiceGroup, FormAlert, FormFooter, FormSection, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { ReleaseSelectionState } from "./form-state";

interface ReleaseSelectionFormProps {
  action: (previous: ReleaseSelectionState, formData: FormData) => Promise<ReleaseSelectionState>;
  initial: ReleaseSelectionState;
  lockVersion: number;
  releaseChoices: Choice[];
  cancelHref: string;
}

/** Chooses only an Assessment's Releases: the Salt Patterns initiative's one editable setting. */
export function ReleaseSelectionForm({ action, initial, lockVersion, releaseChoices, cancelHref }: ReleaseSelectionFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "release-selection-alert");

  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Saving">Save Releases</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="release-selection-alert">{state.errors.base.join(" ")}</FormAlert>}
          <input type="hidden" name="lockVersion" value={lockVersion} />
          <FormSection title="Evaluation" description="Template versions must meet every selected Release to be accepted. Each is evaluated independently; none overrides another.">
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
                  "Only published Releases can be selected. With none selected, templates are accepted on their checks alone and show Not evaluated."
                ) : (
                  <>
                    No Release is published yet. Start from a Salt starter in the <Link href="/standards/new">Standard Library</Link> and publish it.
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
