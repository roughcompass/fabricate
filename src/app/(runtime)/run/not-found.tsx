import Link from "next/link";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { applicationsAvailable } from "@/lib/applications/availability";
import { routes } from "@/lib/web/routes";
import styles from "./not-found.module.css";

/**
 * A running application that isn't available: an unknown or deleted
 * application, one with no successful build yet, or a share link that no
 * longer resolves (page-patterns spec, "Share links that no longer resolve
 * lead back to Applications"). It renders full screen, without the operator
 * shell, with one way back: Applications while previews are on, and Home
 * otherwise.
 */
export default function RunNotFound() {
  const available = applicationsAvailable();
  return (
    <main className={styles.page}>
      <div className={styles.message}>
        <span className={styles.icon}>
          <Icon name="help" size={20} />
        </span>
        <h1 className={styles.title}>Application not available</h1>
        <p className={styles.text}>This link no longer opens an application. The application may have been deleted, it may have no successful build yet, or the link may have been reset.</p>
        <Link href={available ? routes.applications : routes.home} {...buttonProps("primary")}>
          {available ? "Go to Applications" : "Go to Home"}
        </Link>
      </div>
    </main>
  );
}
