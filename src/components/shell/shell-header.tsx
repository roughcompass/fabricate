import { buttonClass } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { SidebarToggle } from "./sidebar-toggle";
import styles from "./shell-header.module.css";

/** The sidebar's element id: the header's controls open, show, and hide it. */
export const SIDEBAR_ID = "sidebar";

/**
 * The header to the right of the sidebar (operator-interface/page-patterns
 * spec): the page's title, centered, as its only top-level heading, and the
 * controls that show a hidden sidebar or, below 1024px, open it as a drawer.
 * Pages render it through PageHeader, system pages and skeletons directly,
 * because the title is page data the layout cannot see. Without a title it
 * shows a loading placeholder, for the page skeletons.
 */
export function ShellHeader({ title }: { title?: string }) {
  return (
    <header className={styles.header} data-shell-header="">
      <div className={styles.start}>
        <span className={styles.showSidebar}>
          <SidebarToggle to="shown" />
        </span>
        {/* A native popover invoker, so the drawer opens without JavaScript. */}
        <span className={styles.openNavigation}>
          <button type="button" popoverTarget={SIDEBAR_ID} className={buttonClass("tertiary", "md", true)} aria-label="Open navigation" title="Open navigation">
            <Icon name="menu" />
          </button>
        </span>
      </div>
      {title === undefined ? (
        <span className={styles.placeholder} aria-hidden="true" />
      ) : (
        <h1 className={styles.title} title={title}>
          {title}
        </h1>
      )}
      <div className={styles.end} />
    </header>
  );
}
