"use client";

import { useActionState } from "react";
import { FormAlert, Select, TextArea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { LESSON_LENGTH } from "@/lib/prototypes/limits";
import { LESSON_CATEGORIES } from "@/lib/prototypes/types";
import type { LessonFormState } from "./actions";
import styles from "./lessons.module.css";

interface LessonFormProps {
  action: (previous: LessonFormState, formData: FormData) => Promise<LessonFormState>;
  initial: { text: string; category: string; scope: string };
  personas: readonly { id: string; name: string }[];
  submitLabel: string;
  id: string;
}

/** A lesson's sentence, category, and scope (learning spec, "Every lesson is short, scoped, categorized, and cited"). */
export function LessonForm({ action, initial, personas, submitLabel, id }: LessonFormProps) {
  const [state, formAction] = useActionState(action, { values: initial, errors: {} });
  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.errors.base && <FormAlert id={`${id}-alert`}>{state.errors.base.join(" ")}</FormAlert>}
      <TextArea id={`${id}-text`} name="text" label="Lesson" description={`One imperative sentence, at most ${LESSON_LENGTH} characters.`} rows={2} defaultValue={state.values.text} errors={state.errors.text} maxLength={LESSON_LENGTH} required key={state.saved} />
      <div className={styles.row}>
        <Select id={`${id}-category`} name="category" label="Category" size="sm" defaultValue={state.values.category} errors={state.errors.category} options={LESSON_CATEGORIES.map((category) => ({ value: category, label: category }))} />
        <Select id={`${id}-scope`} name="scope" label="Applies to" size="sm" defaultValue={state.values.scope} errors={state.errors.scope} options={[{ value: "general", label: "Every persona" }, ...personas.map((persona) => ({ value: persona.id, label: persona.name }))]} />
      </div>
      <div className={styles.row}>
        <SubmitButton size="sm" pendingLabel="Saving">
          {submitLabel}
        </SubmitButton>
        <p role="status" className={styles.muted}>
          {state.saved ? "Saved." : ""}
        </p>
      </div>
    </form>
  );
}
