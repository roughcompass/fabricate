"use client";

import Link from "next/link";
import { NO_OPTIONAL_AREAS, homeLink, visibleSections } from "@/components/shell/navigation";
import { SystemPage } from "@/components/shell/system-page";
import { buttonProps } from "@/components/ui/button-content";

/**
 * An unexpected failure while rendering a page, inside the application shell.
 * It never shows the error's message or stack; the digest matches the
 * server log entry. Its way back opens Home (home spec); the client can't
 * read the configuration, and every configuration shows Assessments, which
 * is all that decides where Home's links lead.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const home = homeLink(visibleSections(NO_OPTIONAL_AREAS));
  return (
    <SystemPage
      icon="alert"
      title="Something went wrong"
      actions={
        <>
          <button type="button" {...buttonProps("primary")} onClick={() => retry()}>
            Try again
          </button>
          <Link href={home.href} {...buttonProps("secondary")}>
            {`Go to ${home.label}`}
          </Link>
        </>
      }
    >
      <p>This page could not be shown. Trying again often works; if it keeps failing, the server log has the details.</p>
      {error.digest && <p>{`Reference ${error.digest}`}</p>}
    </SystemPage>
  );
}
