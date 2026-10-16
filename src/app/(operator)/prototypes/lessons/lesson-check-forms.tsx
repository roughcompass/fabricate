"use client";

import { useActionState, useState } from "react";
import { ChoiceGroup, FormAlert, TextArea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { INTENT_LENGTH, MAX_PERSONAS_PER_INTENT } from "@/lib/prototypes/limits";
import type { BenchmarkFormState, LessonCheckState } from "./actions";
import styles from "./lessons.module.css";

/** Run lesson check, which says before starting that it uses today's generations. */
export function LessonCheckForm({ action, uses, remaining, unavailable }: { action: (previous: LessonCheckState) => Promise<LessonCheckState>; uses: number; remaining: number; unavailable: string | null }) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <form action={formAction} className={styles.form} data-lesson-check-form="">
      {state.error && <FormAlert id="lesson-check-alert">{state.error}</FormAlert>}
      <p className={styles.muted} data-lesson-check-cost="">{`A lesson check generates ${uses} variants, which uses ${uses} of today's generations. ${remaining} ${remaining === 1 ? "is" : "are"} left.`}</p>
      <div className={styles.row}>
        <SubmitButton size="sm" icon="sparkle" pendingLabel="Starting" disabled={Boolean(unavailable) || remaining < uses}>
          Run lesson check
        </SubmitButton>
        {unavailable && <p className={styles.muted}>{unavailable}</p>}
      </div>
    </form>
  );
}

interface BenchmarkFormProps {
  id: string;
  action: (previous: BenchmarkFormState, formData: FormData) => Promise<BenchmarkFormState>;
  initial: { intent: string; scope: string; personas: string[] };
  personas: readonly { id: string; name: string }[];
  label: string;
}

/** One benchmark intent: its intent, scope, and personas (learning spec, "Benchmark intents are workspace data"). */
export function BenchmarkForm({ id, action, initial, personas, label }: BenchmarkFormProps) {
  const [state, formAction] = useActionState(action, { values: initial, errors: {} });
  const [chosen, setChosen] = useState<string[]>(initial.personas);
  return (
    <form action={formAction} className={styles.form} noValidate data-benchmark={id}>
      <TextArea id={`${id}-intent`} name="intent" label={label} rows={2} defaultValue={state.values.intent} errors={state.errors.intent} minLength={INTENT_LENGTH.min} maxLength={INTENT_LENGTH.max} required />
      <ChoiceGroup
        id={`${id}-scope`}
        name="scope"
        legend="Scope"
        type="radio"
        choices={[
          { value: "page", label: "Page" },
          { value: "component", label: "Component" },
        ]}
        selected={[state.values.scope]}
        errors={state.errors.scope}
        columns
      />
      <ChoiceGroup
        id={`${id}-personas`}
        name="personas"
        legend="Personas"
        type="checkbox"
        optional
        choices={personas.map((persona) => ({ value: persona.id, label: persona.name, disabled: chosen.length >= MAX_PERSONAS_PER_INTENT && !chosen.includes(persona.id) }))}
        selected={chosen}
        errors={state.errors.personas}
        columns
        onChange={(event) => setChosen((current) => (event.target.checked ? [...current, event.target.value] : current.filter((value) => value !== event.target.value)))}
      />
      <div className={styles.row}>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving">
          Save benchmark
        </SubmitButton>
        <p role="status" className={styles.muted}>
          {state.saved ? "Saved. The next lesson check uses it." : ""}
        </p>
      </div>
    </form>
  );
}
