"use client";

import { useActionState } from "react";
import { FormAlert, Select, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { PrepareFormState } from "../preview-form-state";
import styles from "./previews.module.css";

interface PrepareFormProps {
  action: (previous: PrepareFormState, formData: FormData) => Promise<PrepareFormState>;
  /** The configured reference first, then the remote's branches and tags. */
  options: React.ComponentProps<typeof Select>["options"];
  /** Says why the remote's other branches and tags aren't listed, or how many were left out. */
  note?: string;
}

const INITIAL: PrepareFormState = { values: { ref: "configured", commit: "" }, errors: {} };

/**
 * Chooses what to preview: a branch or tag of the remote, the configured
 * reference first, or a commit SHA, which takes their place. Submitting pins
 * the commit and prepares it; a ref or SHA that can't be resolved is reported
 * under its field. Works without JavaScript.
 */
export function PrepareForm({ action, options, note }: PrepareFormProps) {
  const [state, formAction] = useActionState(action, INITIAL);
  const form = useFocusFirstInvalid(state, "prepare-preview-alert");
  return (
    <form ref={form} action={formAction} className={styles.prepare} aria-label="Prepare a preview">
      {state.errors.base && <FormAlert id="prepare-preview-alert">{state.errors.base.join(" ")}</FormAlert>}
      <div className={styles.fields}>
        <Select id="preview-ref" name="ref" label="Branch or tag" options={options} defaultValue={state.values.ref} errors={state.errors.ref} description={note} />
        <TextInput
          id="preview-commit"
          name="commit"
          label="Commit"
          optional
          mono
          defaultValue={state.values.commit}
          errors={state.errors.commit}
          description="A full SHA, or at least 4 characters of one, in place of the branch or tag."
          maxLength={40}
        />
      </div>
      <div className={styles.submit}>
        <SubmitButton pendingLabel="Preparing the preview">Prepare preview</SubmitButton>
      </div>
    </form>
  );
}
