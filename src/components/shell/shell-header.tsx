import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { SidebarToggle } from "./sidebar-toggle";
import styles from "./shell-header.module.css";

/** The sidebar's element id: the header's controls open, show, and hide it. */
export const SIDEBAR_ID = "sidebar";

/** A focused page's back button: where it goes, and its name, "Back to" and the parent record's name. */
export interface ShellBack {
  readonly href: string;
  readonly label: string;
}

/**
 * The header to the right of the sidebar (operator-interface/page-patterns
 * spec): the page's title, centered, as its only top-level heading, and the
 * controls that show a hidden sidebar or, below 1024px, open it as a drawer.
 * Pages render it through PageHeader, system pages and skeletons directly,
 * because the title is page data the layout cannot see. Without a title it
 * shows a loading placeholder, for the page skeletons.
 *
 * With `start`, the header also holds that control at its left, after the
 * sidebar controls: the application switcher on the Applications page and
 * application dashboards (make-applications-first-class design decision 10).
 *
 * With `end`, the header holds the page's controls at its right, such as
 * Runtime Configuration's Undo, Redo, Change history, and Save
 * (update-portal-management-journey design decision 4).
 *
 * With `back`, the page is a focused page, as preview mode is: the header
 * holds a back button in place of the sidebar controls, the title stays the
 * page's heading for assistive technology only, and the shell hides the
 * sidebar while the header is on the page (app-shell.module.css). A skeleton
 * passes "placeholder" for the button.
 */
export function ShellHeader({ title, back, start, end }: { title?: string; back?: ShellBack | "placeholder"; start?: React.ReactNode; end?: React.ReactNode }) {
  return (
    <header className={styles.header} data-shell-header={back ? "focused" : ""}>
      <div className={styles.start}>
        {back === "placeholder" ? (
          <span className={styles.backPlaceholder} aria-hidden="true" />
        ) : back ? (
          <ButtonLink href={back.href} variant="tertiary" size="md" icon="arrowLeft" label={back.label} />
        ) : (
          <>
            <span className={styles.showSidebar}>
              <SidebarToggle to="shown" />
            </span>
            {/* A native popover invoker, so the drawer opens without JavaScript. */}
            <span className={styles.openNavigation}>
              <button type="button" popoverTarget={SIDEBAR_ID} {...buttonProps("tertiary", "md", true)} aria-label="Open navigation" title="Open navigation">
                <Icon name="menu" />
              </button>
            </span>
            {start && <div className={styles.slot}>{start}</div>}
          </>
        )}
      </div>
      {title === undefined ? (
        <span className={back ? undefined : styles.placeholder} aria-hidden="true" />
      ) : back ? (
        <h1 className="visually-hidden">{title}</h1>
      ) : (
        <h1 className={styles.title} title={title}>
          {title}
        </h1>
      )}
      <div className={styles.end}>{end}</div>
    </header>
  );
}
