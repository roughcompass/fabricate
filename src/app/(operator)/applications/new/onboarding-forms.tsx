"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, Checkbox, FormAlert, FormFooter, Select, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { BranchState, CloneUrlState, DetailsState } from "./form-states";

/** The step's way back and out: Cancel, which returns to where onboarding was opened, and Previous. */
export interface StepLinks {
  readonly cancel: string;
  readonly previous?: string;
}

function Footer({ links, children }: { links: StepLinks; children?: React.ReactNode }) {
  return (
    <FormFooter>
      <ButtonLink href={links.cancel}>Cancel</ButtonLink>
      {links.previous && <ButtonLink href={links.previous}>Previous</ButtonLink>}
      {children}
    </FormFooter>
  );
}

/** A clone URL the catalog doesn't have yet is registered under its rules; one it has chooses that Repository. */
export function CloneUrlForm({ action, from }: { action: (previous: CloneUrlState, formData: FormData) => Promise<CloneUrlState>; from?: string }) {
  return (
    <ActionForm<CloneUrlState> action={action} initial={{ values: { cloneUrl: "" }, errors: {} }} hidden={{ from }} aria-label="Register a clone URL">
      {(state) => (
        <div className={formStyles.form}>
          <TextInput
            id="onboarding-clone-url"
            name="cloneUrl"
            label="Clone URL"
            mono
            inputMode="url"
            defaultValue={state.values.cloneUrl}
            errors={state.errors.cloneUrl}
            description="file://, https://, or ssh://, without credentials. A URL the catalog has chooses that Repository."
          />
          <div>
            <SubmitButton variant="secondary" pendingLabel="Adding">
              Use this clone URL
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

/** The branch to track, from the remote's branches with the configured reference first, or typed when they can't be listed. */
export function BranchForm({ action, repository, branches, initial, links, from }: { action: (previous: BranchState, formData: FormData) => Promise<BranchState>; repository: string; branches: readonly string[] | null; initial: string; links: StepLinks; from?: string }) {
  return (
    <ActionForm<BranchState> action={action} initial={{ values: { branch: initial }, errors: {} }} alertId="onboarding-branch-alert" hidden={{ repository, from }} aria-label="Choose the branch">
      {(state) => (
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="onboarding-branch-alert">{state.errors.base.join(" ")}</FormAlert>}
          {branches ? (
            <Select
              id="onboarding-branch"
              name="branch"
              label="Branch to track"
              defaultValue={state.values.branch}
              errors={state.errors.branch}
              options={branches.map((branch) => ({ value: branch, label: branch }))}
              description="The application is built from this branch, and rebuilt when it moves."
            />
          ) : (
            <TextInput id="onboarding-branch" name="branch" label="Branch to track" mono defaultValue={state.values.branch} errors={state.errors.branch} description="The remote's branches couldn't be listed. Enter the branch's name." />
          )}
          <Footer links={links}>
            <SubmitButton pendingLabel="Checking">Check eligibility</SubmitButton>
          </Footer>
        </div>
      )}
    </ActionForm>
  );
}

/** The name, description, and trust confirmation; Create records the application, enrolls the remote, and queues the first build. */
export function DetailsForm({ action, hidden, initial, links }: { action: (previous: DetailsState, formData: FormData) => Promise<DetailsState>; hidden: Readonly<Record<string, string>>; initial: { name: string; description: string }; links: StepLinks }) {
  return (
    <ActionForm<DetailsState> action={action} initial={{ values: { ...initial, trusted: false }, errors: {} }} alertId="onboarding-details-alert" hidden={hidden} aria-label="Name the application">
      {(state) => (
        <div className={formStyles.form}>
          {(state.errors.base ?? state.errors.package ?? state.errors.branch) && (
            <FormAlert id="onboarding-details-alert">{[...(state.errors.base ?? []), ...(state.errors.package ?? []), ...(state.errors.branch ?? [])].join(" ")}</FormAlert>
          )}
          <TextInput id="onboarding-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} maxLength={80} required description="Up to 80 characters, unique among applications. Its address comes from it and stays when it's renamed." />
          <TextArea id="onboarding-description" name="description" label="Description" optional defaultValue={state.values.description} errors={state.errors.description} maxLength={280} rows={3} />
          <div className={formStyles.field}>
            <Checkbox
              id="onboarding-trusted"
              name="trusted"
              value="yes"
              defaultChecked={state.values.trusted}
              label="I trust this repository's code to be built and served by the Frontend Registry"
              description="Creating the application enrolls the repository's remote for previews: its install and build scripts run with the worker's permissions, and its pages run on the Frontend Registry's origin."
              aria-invalid={state.errors.trusted ? true : undefined}
            />
            {state.errors.trusted && (
              <p id="onboarding-trusted-error" className={formStyles.error}>
                {state.errors.trusted.join(" ")}
              </p>
            )}
          </div>
          <Footer links={links}>
            <SubmitButton pendingLabel="Creating">Create application</SubmitButton>
          </Footer>
        </div>
      )}
    </ActionForm>
  );
}
