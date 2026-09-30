"use client";

import "./globals.css";
import Link from "next/link";
import { SystemPage } from "@/components/shell/system-page";
import { buttonClass } from "@/components/ui/button-content";

/**
 * A failure in the root layout itself. It replaces the whole document, so it
 * brings its own html and body and the global styles, and follows the
 * operating system's theme.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Fabricate</title>
        <main>
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
            <p>Fabricate could not be shown. If trying again does not work, the server log has the details.</p>
            {error.digest && <p>{`Reference ${error.digest}`}</p>}
          </SystemPage>
        </main>
      </body>
    </html>
  );
}
