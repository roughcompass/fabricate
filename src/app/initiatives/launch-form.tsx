"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button-content";
import { PageAlertPortal } from "@/components/ui/page-alert-portal";
import { SubmitButton } from "@/components/ui/submit-button";
import type { LaunchState } from "./form-state";

interface LaunchFormProps {
  action: (previous: LaunchState, formData: FormData) => Promise<LaunchState>;
  launchToken: string;
  label: string;
  /** The page alert's title when the launch is refused. */
  failure: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A fuller accessible name, such as "Start Evaluation of Assessment #2". */
  accessibleName?: string;
}

/**
 * Starts an Assessment or an Evaluation. The launch token is generated when
 * the page renders, so resubmitting the same page returns the run it already
 * started. A refusal lists its problems in one alert below the page header,
 * never inside the header actions or a table cell.
 */
export function LaunchForm({ action, launchToken, label, failure, variant = "primary", size = "md", accessibleName }: LaunchFormProps) {
  const [state, formAction] = useActionState(action, { problems: [] });
  return (
    <form action={formAction} style={{ display: "contents" }}>
      <input type="hidden" name="launchToken" value={launchToken} />
      <SubmitButton icon={variant === "primary" ? "play" : undefined} pendingLabel="Starting" variant={variant} size={size} aria-label={accessibleName}>
        {label}
      </SubmitButton>
      {state.problems.length > 0 && (
        <PageAlertPortal>
          <Alert tone="error" title={failure} live>
            <ul>
              {state.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        </PageAlertPortal>
      )}
    </form>
  );
}
