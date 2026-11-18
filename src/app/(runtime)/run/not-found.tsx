import Link from "next/link";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { demoEnabled } from "@/lib/demo/guard";
import styles from "./not-found.module.css";

/**
 * A running application that is no longer available: an unknown template, or
 * a share link that no longer resolves. It renders
 * full screen, without the operator shell, and offers a way back
 * (page-patterns spec, "Every link opens the page it names"). While the demo
 * is disabled, the way back is the Assessments list; otherwise, Salt Patterns.
 */
export default function RunNotFound() {
  const demo = demoEnabled();
  return (
    <main className={styles.page}>
      <div className={styles.message}>
        <span className={styles.icon}>
          <Icon name="help" size={20} />
        </span>
        <h1 className={styles.title}>Application not available</h1>
        <p className={styles.text}>This link no longer opens an application. Its template may have been removed, or the demo may have been reset.</p>
        <Link href={demo ? "/templates" : "/assessments"} {...buttonProps("primary")}>
          {demo ? "Go to Salt Patterns" : "Go to Assessments"}
        </Link>
      </div>
    </main>
  );
}
