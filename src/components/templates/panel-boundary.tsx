"use client";

import { type ErrorInfo, catchError } from "next/error";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A Dashboard panel's error: what failed, and Try again. In the browser Try
 * again reads the panel again (`retry`); a panel whose read failed on the
 * server offers a link that loads the page again, which works without
 * JavaScript.
 */
export function PanelFailure({ title, retry }: { title: string; retry?: () => void }) {
  return (
    <EmptyState
      title={`${title} couldn't be shown`}
      icon="alert"
      action={
        retry ? (
          <Button size="sm" icon="refresh" onClick={retry}>
            Try again
          </Button>
        ) : (
          <ButtonLink href="" size="sm" icon="refresh">
            Try again
          </ButtonLink>
        )
      }
    >
      The rest of the page is unaffected. If trying again doesn&apos;t work, the server log has the details.
    </EmptyState>
  );
}

function PanelError({ title }: { title: string }, { retry }: ErrorInfo) {
  return <PanelFailure title={title} retry={() => retry()} />;
}

/**
 * An error boundary around one Dashboard panel's content (page-templates
 * spec, "One panel fails"), for a failure while the browser renders it.
 */
export const PanelBoundary = catchError(PanelError);
