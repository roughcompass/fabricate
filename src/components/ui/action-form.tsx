"use client";

import { useActionState } from "react";
import { HiddenFields, type HiddenValues } from "./form";
import { useFocusFirstInvalid } from "./use-focus-first-invalid";

interface ActionFormProps<State> {
  action: (previous: Awaited<State>, formData: FormData) => Promise<State>;
  initial: Awaited<State>;
  /** The form alert focused when a refusal isn't about a field. */
  alertId?: string;
  /** Whether a refusal moves focus to the first invalid field; off for a form that moves focus itself. */
  focusInvalid?: boolean;
  /** Values the form submits without showing them, such as a lock version. */
  hidden?: HiddenValues;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  /** The form's content, from the state of its latest submission. */
  children: (state: Awaited<State>) => React.ReactNode;
}

/**
 * The one form shell for Server Actions (prune-and-consolidate-code, design
 * decision 7): it holds the action's state, renders its content from it, and
 * after a refusal moves focus to the first invalid field, or to the alert.
 */
export function ActionForm<State>({ action, initial, alertId, focusInvalid = true, hidden, className, style, "aria-label": label, children }: ActionFormProps<State>) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, alertId, focusInvalid);
  return (
    <form ref={form} action={formAction} noValidate className={className} style={style} aria-label={label}>
      <HiddenFields values={hidden} />
      {children(state)}
    </form>
  );
}
