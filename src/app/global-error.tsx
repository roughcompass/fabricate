"use client";

import "./globals.css";
import Link from "next/link";
import { HOME } from "@/components/shell/navigation";
import { SystemPage } from "@/components/shell/system-page";
import { buttonProps } from "@/components/ui/button-content";
import { PRODUCT, browserTitle } from "@/lib/product";

/**
 * A failure in the root layout itself. It replaces the whole document, so it
 * brings its own html and body and the global styles, and follows the
 * operating system's theme. Its way back opens Home, as the error page's does.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>{browserTitle("Something went wrong")}</title>
        <main>
          <SystemPage
            icon="alert"
            title="Something went wrong"
            actions={
              <>
                <button type="button" {...buttonProps("primary")} onClick={() => retry()}>
                  Try again
                </button>
                <Link href={HOME.href} {...buttonProps("secondary")}>
                  {`Go to ${HOME.label}`}
                </Link>
              </>
            }
          >
            <p>{`The ${PRODUCT.name} could not be shown. If trying again does not work, the server log has the details.`}</p>
            {error.digest && <p>{`Reference ${error.digest}`}</p>}
          </SystemPage>
        </main>
      </body>
    </html>
  );
}
