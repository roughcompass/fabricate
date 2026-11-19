"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm, FormAlert, FormFooter, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { repositoryNameFromUrl } from "@/lib/repositories/repository-name";
import type { RepositoryFormState } from "./repository-form-state";

interface RepositoryFormProps {
  action: (previous: RepositoryFormState, formData: FormData) => Promise<RepositoryFormState>;
  initial: RepositoryFormState;
  lockVersion?: number;
  submitLabel: string;
  /** "plain" for a settings page: the fields on the page, with Cancel and the action under them. */
  layout?: "panel" | "plain";
  /** Where Cancel goes: the Repositories list, or on a settings page the Repository. */
  cancelHref?: string;
}

/**
 * The New and Edit Repository form: the clone URL first, then the name,
 * which follows the URL's owner and repository, such as vickykatoch-helios,
 * until someone types one of their own. Clearing it follows the URL again; a blank name is saved as
 * the URL's, so the form works the same without JavaScript.
 */
export function RepositoryForm({ action, initial, lockVersion, submitLabel, layout = "panel", cancelHref = "/repositories" }: RepositoryFormProps) {
  return (
    <ActionForm action={action} initial={initial} alertId="source-form-alert" hidden={{ lockVersion }}>
      {(state) => <RepositoryFields state={state} submitLabel={submitLabel} layout={layout} cancelHref={cancelHref} />}
    </ActionForm>
  );
}

/** The form's fields and its action, from the state of its latest submission. */
function RepositoryFields({ state, submitLabel, layout, cancelHref }: { state: RepositoryFormState; submitLabel: string; layout: "panel" | "plain"; cancelHref: string }) {
  const [name, setName] = useState(state.values.name);
  const [typed, setTyped] = useState(state.values.name.trim() !== "");
  // A rejected submission renders the values it carried.
  const [shown, setShown] = useState(state);
  if (shown !== state) {
    setShown(state);
    setName(state.values.name);
    setTyped(state.values.name.trim() !== "");
  }

  const fields = (
    <div className={formStyles.form}>
      {state.errors.base && <FormAlert id="source-form-alert">{state.errors.base.join(" ")}</FormAlert>}
      <TextInput
        id="source-clone-url"
        name="cloneUrl"
        label="Clone URL"
        mono
        inputMode="url"
        defaultValue={state.values.cloneUrl}
        errors={state.errors.cloneUrl}
        description="file://, https://, or ssh:// only; leave credentials out, since the server's SSH agent or Git credential helper supplies them."
        required
        onChange={(event) => {
          if (!typed) setName(repositoryNameFromUrl(event.target.value));
        }}
      />
      <TextInput
        id="source-name"
        name="name"
        label="Name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setTyped(event.target.value.trim() !== "");
        }}
        errors={state.errors.name}
        description="A display name, the clone URL's owner and repository unless you change it. Repositories are identified by their canonical clone URL, not by name."
        maxLength={100}
      />
      <TextInput
        id="source-git-ref"
        name="gitRef"
        label="Reference"
        optional
        mono
        defaultValue={state.values.gitRef}
        errors={state.errors.gitRef}
        description="A branch, tag, or full commit SHA. Leave it blank to assess the default branch."
      />
    </div>
  );

  return layout === "plain" ? (
    <div className={formStyles.form}>
      {fields}
      <FormFooter>
        <ButtonLink href={cancelHref}>Cancel</ButtonLink>
        <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
      </FormFooter>
    </div>
  ) : (
    <Panel
      footer={
        <FormFooter>
          <ButtonLink href={cancelHref}>Cancel</ButtonLink>
          <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
        </FormFooter>
      }
    >
      {fields}
    </Panel>
  );
}
