"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import type { LaunchState } from "./form-state";
import styles from "./initiatives.module.css";

/**
 * Starts an Assessment. The launch token is generated when the page renders,
 * so resubmitting the same page returns the Assessment it already started.
 */
export function LaunchForm({ action, launchToken }: { action: (previous: LaunchState, formData: FormData) => Promise<LaunchState>; launchToken: string }) {
  const [state, formAction] = useActionState(action, { problems: [] });

  return (
    <form action={formAction} className={styles.launch}>
      <input type="hidden" name="launchToken" value={launchToken} />
      <SubmitButton icon="play" pendingLabel="Starting…">
        Start assessment
      </SubmitButton>
      {state.problems.length > 0 && (
        <Notice tone="error" title="The assessment was not started because its scope could not be resolved.">
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
