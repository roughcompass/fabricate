"use client";

import { useActionState } from "react";
import { ChoiceGroup, FormAlert, TextArea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { RatingState } from "./actions";
import styles from "./prototype.module.css";

/** Rates a version from 1 to 5 with an optional note; rating it again replaces the earlier rating (learning spec). */
export function RatingForm({ action, current, v }: { action: (previous: RatingState, formData: FormData) => Promise<RatingState>; current: { rating: number; note: string } | null; v: string | null }) {
  const [state, formAction] = useActionState(action, { values: { rating: current ? String(current.rating) : "", note: current?.note ?? "" }, errors: {} });
  return (
    <form action={formAction} className={styles.rating} noValidate data-rating-form="">
      {v && <input type="hidden" name="v" value={v} />}
      {state.errors.base && <FormAlert id="rating-alert">{state.errors.base.join(" ")}</FormAlert>}
      <ChoiceGroup
        id="rating"
        name="rating"
        legend={current ? "Your rating" : "Rate this version"}
        type="radio"
        columns
        choices={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value), description: value === 1 ? "Poor" : value === 5 ? "Excellent" : undefined }))}
        selected={[state.values.rating]}
        errors={state.errors.rating}
        description="Ratings measure progress across generations; only a note teaches lessons."
      />
      <TextArea id="rating-note" name="note" label="Note" optional rows={2} defaultValue={state.values.note} errors={state.errors.note} maxLength={2000} />
      <div className={styles.ratingActions}>
        <SubmitButton size="sm" pendingLabel="Saving">
          {current ? "Replace rating" : "Save rating"}
        </SubmitButton>
        <p role="status" className={styles.muted}>
          {state.saved ? "Your rating was saved. It replaces any earlier rating of this version." : ""}
        </p>
      </div>
    </form>
  );
}
