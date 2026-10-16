"use client";

import { useActionState } from "react";
import type { FormState } from "@/components/ui/form";
import { TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import styles from "./prototype.module.css";

/** Renames a prototype (versions spec, "Prototypes can be renamed and deleted"). */
export function RenameForm({ action, name }: { action: (previous: FormState<{ name: string }>, formData: FormData) => Promise<FormState<{ name: string }>>; name: string }) {
  const [state, formAction] = useActionState(action, { values: { name }, errors: {} });
  return (
    <form action={formAction} className={styles.rename} noValidate>
      <TextInput id="prototype-name" name="name" label="Name" size="sm" defaultValue={state.values.name} errors={state.errors.name} required maxLength={120} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving">
        Rename
      </SubmitButton>
    </form>
  );
}
