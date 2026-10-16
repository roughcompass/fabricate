"use client";

import { useActionState } from "react";
import type { FormState } from "./form";
import { FormAlert, TextArea } from "./form";
import { SubmitButton } from "./submit-button";
import { useFocusFirstInvalid } from "./use-focus-first-invalid";
import styles from "./composer.module.css";

export type ComposerFormState = FormState<{ message: string }>;

interface ComposerProps {
  action: (previous: ComposerFormState, formData: FormData) => Promise<ComposerFormState>;
  label: string;
  placeholder?: string;
  /** Why sending is unavailable, such as a refinement already running; null when it is available. */
  unavailable: string | null;
  /** Hidden fields sent with the message. */
  fields?: Record<string, string>;
  maxLength: number;
  submitLabel?: string;
}

/**
 * A message box with Send, for asking for a change (design.md, decision 15).
 * While sending is unavailable it says why, and Send is disabled, rather than
 * failing after submission.
 */
export function Composer({ action, label, placeholder, unavailable, fields = {}, maxLength, submitLabel = "Send" }: ComposerProps) {
  const [state, formAction] = useActionState(action, { values: { message: "" }, errors: {} });
  const form = useFocusFirstInvalid(state, "composer-message-alert");
  return (
    <form ref={form} action={formAction} className={styles.composer} noValidate data-composer="">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.errors.base && <FormAlert id="composer-message-alert">{state.errors.base.join(" ")}</FormAlert>}
      <TextArea id="composer-message" name="message" label={label} rows={3} placeholder={placeholder} defaultValue={state.values.message} errors={state.errors.message} maxLength={maxLength} disabled={Boolean(unavailable)} description={unavailable ?? undefined} />
      <div className={styles.actions}>
        <SubmitButton icon="arrowUp" disabled={Boolean(unavailable)} pendingLabel="Sending">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
