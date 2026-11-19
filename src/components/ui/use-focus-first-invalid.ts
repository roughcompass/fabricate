"use client";

import { useEffect, useRef } from "react";

/**
 * After a rejected submission, moves focus to the first invalid field, or to
 * the form alert when the error is not about a field. Attach the returned ref
 * to the form. The initial state never moves focus, so neither does a render
 * before the first submission.
 */
export function useFocusFirstInvalid<State>(state: State, alertId?: string, enabled = true) {
  const form = useRef<HTMLFormElement>(null);
  const initial = useRef(state);

  useEffect(() => {
    if (!enabled || state === initial.current) return;
    const field = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]:is(input, select, textarea), fieldset[aria-invalid="true"] input:not(:disabled)');
    const target = field ?? (alertId ? document.getElementById(alertId) : null);
    target?.focus();
  }, [state, alertId, enabled]);

  return form;
}
