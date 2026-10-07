"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, type FormState, FormNote, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";

export type DraftValues = Record<string, string | string[]>;
export type DraftFormState = FormState<DraftValues> & {
  /** The lock version to save against: the one the Draft had when the page opened, or after a save. */
  lockVersion: number;
};
export type DraftAction = (previous: DraftFormState, formData: FormData) => Promise<DraftFormState>;

export const value = (state: DraftFormState, field: string): string => {
  const entry = state.values[field];
  return typeof entry === "string" ? entry : "";
};
export const values = (state: DraftFormState, field: string): string[] => {
  const entry = state.values[field];
  return Array.isArray(entry) ? entry : typeof entry === "string" && entry ? [entry] : [];
};

interface DraftFormProps {
  id: string;
  action: DraftAction;
  initial: DraftFormState;
  cancelHref: string;
  submitLabel?: string;
  /** Buttons before the primary action, such as Save and continue; each submits with its own intent. */
  extraButtons?: React.ReactNode;
  /** Issues about the step as a whole, not one field, from the latest check of the Draft. */
  notes?: readonly string[];
  children: (state: DraftFormState) => React.ReactNode;
}

/**
 * One step of a Draft: its fields in one Panel whose footer holds Cancel and
 * Save draft. Each save names the Draft's lock version, so a save based on a
 * Draft someone changed since is refused with what was entered kept, and the
 * alert at the top says so and takes focus.
 */
export function DraftForm({ id, action, initial, cancelHref, submitLabel = "Save draft", extraButtons, notes = [], children }: DraftFormProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, `${id}-alert`);
  return (
    <form ref={form} action={formAction} noValidate data-draft-form={id}>
      {/* Enter in a field submits the form's first submit button: this one, so it saves rather than adding a row. */}
      <button type="submit" name="intent" value="save" className="visually-hidden" tabIndex={-1} aria-hidden="true">
        {submitLabel}
      </button>
      <input type="hidden" name="lockVersion" value={state.lockVersion} />
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            {extraButtons}
            <SubmitButton pendingLabel="Saving" name="intent" value="save">
              {submitLabel}
            </SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id={`${id}-alert`}>{state.errors.base.join(" ")}</FormAlert>}
          {notes.length > 0 && (
            <FormNote title="To fix before submitting">
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </FormNote>
          )}
          {children(state)}
        </div>
      </Panel>
    </form>
  );
}

/** The name a person acts under: typed, or remembered from last time, and never verified. */
export function ActorField({ state, id = "actor", label = "Your name" }: { state: DraftFormState | FormState<DraftValues>; id?: string; label?: string }) {
  const entry = state.values.actor;
  return (
    <TextInput
      id={id}
      name="actor"
      label={label}
      defaultValue={typeof entry === "string" ? entry : ""}
      errors={state.errors.actor}
      description="Recorded with what you do here, labeled Unverified: DE FabLab has no sign-in yet, so it can't check who you are."
      autoComplete="name"
      maxLength={200}
      required
    />
  );
}
