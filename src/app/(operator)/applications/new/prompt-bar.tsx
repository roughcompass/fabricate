"use client";

import { useActionState } from "react";
import type { DialogAction } from "@/components/onboarding/form-dialog";
import { TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import styles from "./new.module.css";

/**
 * Paste a repository URL, or describe what to build (application-creation
 * spec, "The prompt bar accepts a repository URL or a description"). A
 * refused URL stays in the field with why, except one with credentials.
 * Works without JavaScript.
 */
export function PromptBar({ action }: { action: DialogAction }) {
  const [state, formAction] = useActionState(action, { values: { prompt: "" }, errors: {} });
  const form = useFocusFirstInvalid(state);
  const value = state.values.prompt;
  return (
    <form ref={form} action={formAction} className={styles.prompt} noValidate>
      <div className={styles.promptField}>
        <TextInput
          id="build-prompt"
          name="prompt"
          label="Paste a Bitbucket or GitHub repository URL, or describe what you want to build"
          hideLabel
          placeholder="https://github.com/acme/payee-hub, or a payments dashboard"
          defaultValue={typeof value === "string" ? value : ""}
          errors={state.errors.prompt}
          maxLength={500}
          autoComplete="off"
        />
      </div>
      <SubmitButton icon="arrowRight" label="Continue" pendingLabel="Continuing" />
    </form>
  );
}
