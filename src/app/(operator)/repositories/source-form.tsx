"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { SourceFormState } from "./source-form-state";

interface SourceFormProps {
  action: (previous: SourceFormState, formData: FormData) => Promise<SourceFormState>;
  initial: SourceFormState;
  lockVersion?: number;
  submitLabel: string;
  /** The Application registered from the Repository, which fixes its clone URL. */
  application?: { publicId: string; name: string };
}

export function SourceForm({ action, initial, lockVersion, submitLabel, application }: SourceFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "source-form-alert");

  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href="/repositories">Cancel</ButtonLink>
            <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="source-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          {lockVersion !== undefined && <input type="hidden" name="lockVersion" value={lockVersion} />}
          <TextInput
            id="source-name"
            name="name"
            label="Name"
            defaultValue={state.values.name}
            errors={state.errors.name}
            description="A display name. The catalog identifies Repositories by their canonical clone URL, not by name."
            required
            maxLength={100}
          />
          <TextInput
            id="source-clone-url"
            name="cloneUrl"
            label="Clone URL"
            mono
            inputMode="url"
            defaultValue={state.values.cloneUrl}
            errors={state.errors.cloneUrl}
            readOnly={Boolean(application)}
            description={
              application ? (
                <>
                  <Link href={`/applications/${application.publicId}`}>{application.name}</Link> is registered from this Repository, so its clone URL can&apos;t change.
                </>
              ) : (
                "file://, https://, or ssh:// only. Leave credentials out; the worker's SSH agent or Git credential helper supplies them."
              )
            }
            required
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
      </Panel>
    </form>
  );
}
