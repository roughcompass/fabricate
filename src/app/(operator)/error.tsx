"use client";

import Link from "next/link";
import { SystemPage } from "@/components/shell/system-page";
import { buttonClass } from "@/components/ui/button-content";

/**
 * An unexpected failure while rendering a page, inside the application shell.
 * It never shows the error's message or stack; the digest matches the
 * server log entry.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <SystemPage
      icon="alert"
      title="Something went wrong"
      actions={
        <>
          <button type="button" className={buttonClass("primary")} onClick={() => retry()}>
            Try again
          </button>
          <Link href="/" className={buttonClass("secondary")}>
            Go to Initiatives
          </Link>
        </>
      }
    >
      <p>This page could not be shown. Trying again often works; if it keeps failing, the server log has the details.</p>
      {error.digest && <p>{`Reference ${error.digest}`}</p>}
    </SystemPage>
  );
}
