"use client";

import { useActionState } from "react";
import { TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { PromptState } from "./form-state";
import styles from "./new.module.css";

/**
 * Describe what to build, or paste a repository URL. A description opens the
 * gallery searched for it; a repository in the demo's BitBucket opens its
 * import. Works without JavaScript.
 */
export function PromptBar({ action, placeholder }: { action: (previous: PromptState, formData: FormData) => Promise<PromptState>; placeholder: string }) {
  const [state, formAction] = useActionState(action, { values: { prompt: "" }, errors: {} });
  const form = useFocusFirstInvalid(state);
  return (
    <form ref={form} action={formAction} className={styles.prompt} noValidate>
      <div className={styles.promptField}>
        <TextInput id="new-prompt" name="prompt" label="Describe what you want to build, or paste a BitBucket repository URL" hideLabel placeholder={placeholder} defaultValue={state.values.prompt} errors={state.errors.prompt} maxLength={500} autoComplete="off" />
      </div>
      <SubmitButton icon="arrowRight" label="Start building" pendingLabel="Starting" />
    </form>
  );
}
