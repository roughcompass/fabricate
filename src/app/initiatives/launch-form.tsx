"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ButtonVariant } from "@/components/ui/button";
import type { LaunchState } from "./form-state";
import styles from "./initiatives.module.css";

interface LaunchFormProps {
  action: (previous: LaunchState, formData: FormData) => Promise<LaunchState>;
  launchToken: string;
  label?: string;
  failure?: string;
  variant?: ButtonVariant;
}

/**
 * Starts an Assessment or an Evaluation. The launch token is generated when
 * the page renders, so resubmitting the same page returns the run it already
 * started.
 */
export function LaunchForm({ action, launchToken, label = "Start assessment", failure = "The assessment was not started because its scope could not be resolved.", variant = "primary" }: LaunchFormProps) {
  const [state, formAction] = useActionState(action, { problems: [] });

  return (
    <form action={formAction} className={styles.launch}>
      <input type="hidden" name="launchToken" value={launchToken} />
      <SubmitButton icon="play" pendingLabel="Starting…" variant={variant}>
        {label}
      </SubmitButton>
      {state.problems.length > 0 && (
        <Notice tone="error" title={failure}>
          <ul>
            {state.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      )}
    </form>
  );
}
