"use client";

import { type ErrorInfo, catchError } from "next/error";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** A Dashboard panel's error: what failed, and Try again, which reads the panel again. */
function PanelError({ title }: { title: string }, { retry }: ErrorInfo) {
  return (
    <EmptyState
      title={`${title} couldn't be shown`}
      icon="alert"
      action={
        <Button size="sm" icon="refresh" onClick={() => retry()}>
          Try again
        </Button>
      }
    >
      The rest of the page is unaffected. If trying again doesn&apos;t work, the server log has the details.
    </EmptyState>
  );
}

/**
 * An error boundary around one Dashboard panel's content (page-templates
 * spec, "One panel fails"), so a failed read shows in its panel and the
 * other panels render.
 */
export const PanelBoundary = catchError(PanelError);

/** The panel error, as the gallery shows it. */
export function PanelErrorPreview({ title }: { title: string }) {
  return (
    <EmptyState title={`${title} couldn't be shown`} icon="alert" action={<Button size="sm" icon="refresh">Try again</Button>}>
      The rest of the page is unaffected. If trying again doesn&apos;t work, the server log has the details.
    </EmptyState>
  );
}
