"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ChoiceGroup, FormAlert, FormFooter, FormNote, FormSection, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { defaultRepositoryName } from "@/lib/demo/bitbucket";
import type { DeployFormState } from "./deploy-form-state";

const subscribeNever = () => () => {};

interface DeployFormProps {
  action: (previous: DeployFormState, formData: FormData) => Promise<DeployFormState>;
  initial: DeployFormState;
  cancelHref: string;
}

/**
 * Sandbox or dev environment. A dev environment also needs a BitBucket
 * project and repository; the repository follows the application name until
 * it is edited. Without JavaScript, the BitBucket fields are always shown.
 */
export function DeployForm({ action, initial, cancelHref }: DeployFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "deploy-form-alert");
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [environment, setEnvironment] = useState(state.values.environment);
  const [repository, setRepository] = useState(state.values.repository);
  const [repositoryEdited, setRepositoryEdited] = useState(state.values.repository !== defaultRepositoryName(state.values.name));
  const showBitbucket = !hydrated || environment === "dev";

  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Creating">Create application</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="deploy-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          {/* Where the application runs, whichever environment is chosen: a form note, not a page alert (design.md, decision 8). */}
          <FormNote title="Deploys to DE Web Managed Hosting" icon="cloud">
            DE Web Managed Hosting builds and runs your application in the environment you choose below.
          </FormNote>
          <TextInput
            id="deploy-name"
            name="name"
            label="Application name"
            defaultValue={state.values.name}
            errors={state.errors.name}
            description="Shown on the application's page and in its portal."
            required
            maxLength={80}
            onChange={(event) => {
              if (!repositoryEdited) setRepository(defaultRepositoryName(event.currentTarget.value));
            }}
          />
          <ChoiceGroup
            id="deploy-environment"
            name="environment"
            legend="Environment"
            type="radio"
            columns
            selected={[state.values.environment]}
            errors={state.errors.environment}
            onChange={(event) => setEnvironment(event.currentTarget.value)}
            choices={[
              { value: "sandbox", label: "Sandbox", description: "A private deployment for trying the template. No repository is created." },
              { value: "dev", label: "Dev environment", description: "Creates a BitBucket repository from the template and deploys it to dev." },
            ]}
          />
          {showBitbucket && (
            <FormSection title="BitBucket" description={hydrated ? "Where the new repository is created." : "Only needed for a dev environment."}>
              <TextInput
                id="deploy-project"
                name="project"
                label="BitBucket project"
                mono
                defaultValue={state.values.project}
                errors={state.errors.project}
                description="The project key, such as PAY: 2 to 10 uppercase letters and digits."
                autoCapitalize="characters"
                maxLength={10}
              />
              <TextInput
                id="deploy-repository"
                name="repository"
                label="Repository name"
                mono
                value={repository}
                onChange={(event) => {
                  setRepository(event.currentTarget.value);
                  setRepositoryEdited(true);
                }}
                errors={state.errors.repository}
                description="Lowercase letters, digits, and hyphens."
                maxLength={62}
              />
            </FormSection>
          )}
        </div>
      </Panel>
    </form>
  );
}
