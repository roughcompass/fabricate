import { ShellHeader } from "@/components/shell/shell-header";
import { PageAlerts } from "./alert";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { ButtonLink } from "./button";
import type { IconName } from "./icon";
import { Menu, MenuItem } from "./menu";
import styles from "./page.module.css";

/**
 * A page body: `content` for lists and detail pages, `form` for every create
 * and edit form. It spans the content column: the shell header runs its full
 * width, and everything else is centered at the page's measure. `busy` marks
 * a loading skeleton.
 */
export function Page({ width = "content", busy = false, children }: { width?: "content" | "form"; busy?: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.page} data-width={width} aria-busy={busy || undefined} aria-label={busy ? "Loading" : undefined}>
      {children}
    </div>
  );
}

export interface HeaderLink {
  label: string;
  href: string;
  icon?: IconName;
}

interface PageHeaderProps {
  /** The record's ancestors; top-level list pages have none. */
  breadcrumbs?: readonly Crumb[];
  title: string;
  status?: React.ReactNode;
  /** Short facts on one line, such as the parent and relevant times. */
  meta?: readonly React.ReactNode[];
  /** One sentence, at most. */
  description?: React.ReactNode;
  /** The page's single primary action. */
  primaryAction?: React.ReactNode;
  /** Other actions that navigate; on narrow screens they move into a menu when there is a primary action. */
  secondaryActions?: readonly HeaderLink[];
  /** Other actions that are not links, such as a confirmation dialog; always visible. */
  extraActions?: React.ReactNode;
  /** Conditions that need attention, shown in the page-alert slot below the header; `false` omits the slot, as in the gallery's specimens. */
  alerts?: React.ReactNode | false;
  /**
   * 1 for a page: the title goes in the shell header as the page's only `h1`.
   * 3 for the gallery's specimens: the title stays in the header, inline.
   */
  headingLevel?: 1 | 3;
}

/**
 * The top of a page (operator-interface/page-patterns spec): the title in the
 * shell header, then breadcrumbs, the status and meta line, the description,
 * and the actions. The title is never repeated in the page.
 */
export function PageHeader({ breadcrumbs, title, status, meta, description, primaryAction, secondaryActions = [], extraActions, alerts, headingLevel = 1 }: PageHeaderProps) {
  const inline = headingLevel === 3;
  const collapse = Boolean(primaryAction) && secondaryActions.length > 0;
  const hasActions = Boolean(primaryAction || extraActions || secondaryActions.length);
  const hasCrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);
  const hasMeta = Boolean(status) || Boolean(meta && meta.length > 0);
  const hasHeading = inline || hasMeta || Boolean(description);
  const metaItems = meta?.map((item, index) => (
    <span key={index} className={styles.metaItem}>
      {item}
    </span>
  ));

  return (
    <>
      {!inline && <ShellHeader title={title} />}
      {(hasCrumbs || hasHeading || hasActions) && (
        <header className={styles.header} data-page-header="">
          {hasCrumbs && <Breadcrumbs items={breadcrumbs!} />}
          {(hasHeading || hasActions) && (
            <div className={styles.titleRow}>
              {hasHeading ? (
                <div className={styles.heading}>
                  {inline ? (
                    <>
                      <div className={styles.titleLine}>
                        <h3 className={styles.title}>{title}</h3>
                        {status}
                      </div>
                      {metaItems && metaItems.length > 0 && <div className={styles.meta}>{metaItems}</div>}
                    </>
                  ) : (
                    hasMeta && (
                      <div className={styles.meta}>
                        {status && <span className={styles.status}>{status}</span>}
                        {metaItems}
                      </div>
                    )
                  )}
                  {description && <p className={styles.description}>{description}</p>}
                </div>
              ) : (
                <span className={styles.spacer} />
              )}
              {hasActions && (
                <div className={styles.actions}>
                  {secondaryActions.length > 0 && (
                    <span className={collapse ? styles.wide : styles.always}>
                      {secondaryActions.map((action) => (
                        <ButtonLink key={action.label} href={action.href} icon={action.icon}>
                          {action.label}
                        </ButtonLink>
                      ))}
                    </span>
                  )}
                  {collapse && (
                    <span className={styles.narrow}>
                      <Menu label="More actions" variant="secondary" size="md">
                        {secondaryActions.map((action) => (
                          <MenuItem key={action.label} href={action.href} icon={action.icon}>
                            {action.label}
                          </MenuItem>
                        ))}
                      </Menu>
                    </span>
                  )}
                  {extraActions}
                  {primaryAction}
                </div>
              )}
            </div>
          )}
        </header>
      )}
      {alerts !== false && <PageAlerts>{alerts}</PageAlerts>}
    </>
  );
}
