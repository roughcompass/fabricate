import { Disclosure } from "./disclosure";
import styles from "./confirm-dialog.module.css";

/** The class for a <dialog> that holds SplitPanes: wide, scrolling inside the viewport, and full-screen below 768px. */
export const splitDialogClass = `${styles.dialog} ${styles.splitDialog}`;

interface SplitPanesProps {
  /** The aside pane's heading, also the disclosure's summary when the panes stack. */
  asideTitle: string;
  /** Supporting content, such as what a record includes. Without it, the main pane fills the width. */
  aside?: React.ReactNode;
  /** Draws the panes as a bordered surface, for use on a page instead of in a dialog. */
  surface?: boolean;
  children: React.ReactNode;
}

/**
 * The split dialog layout (design-system docs, "Split dialog"): a supporting
 * aside pane beside the main pane. When the panes are narrower than 720px,
 * the main pane comes first and the aside follows it, collapsed under a
 * disclosure. Both arrangements are rendered and CSS shows one, so the switch
 * needs no JavaScript.
 */
export function SplitPanes({ asideTitle, aside, surface = false, children }: SplitPanesProps) {
  return (
    <div className={styles.panes} data-panel={surface ? "" : undefined} data-surface={surface ? "" : undefined}>
      <div className={styles.split} data-aside={aside ? "" : undefined}>
        {aside && (
          <section className={styles.aside} aria-label={asideTitle}>
            <h2 className={styles.asideTitle}>{asideTitle}</h2>
            {aside}
          </section>
        )}
        <div className={styles.main}>{children}</div>
        {aside && (
          <div className={styles.asideStacked}>
            <Disclosure summary={asideTitle} variant="plain">
              {aside}
            </Disclosure>
          </div>
        )}
      </div>
    </div>
  );
}
