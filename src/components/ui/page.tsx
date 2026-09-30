import { PageAlerts } from "./alert";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { ButtonLink } from "./button";
import type { IconName } from "./icon";
import { Menu, MenuItem } from "./menu";
import styles from "./page.module.css";

/** A page body: `content` for lists and detail pages, `form` for every create and edit form. */
export function Page({ width = "content", children }: { width?: "content" | "form"; children: React.ReactNode }) {
  return (
    <div className={styles.page} data-width={width}>
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
  /** The title's heading level; only the gallery's specimens lower it, so each page keeps one `h1`. */
  headingLevel?: 1 | 3;
}

export function PageHeader({ breadcrumbs, title, status, meta, description, primaryAction, secondaryActions = [], extraActions, alerts, headingLevel = 1 }: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h3";
  const collapse = Boolean(primaryAction) && secondaryActions.length > 0;
  const hasActions = Boolean(primaryAction || extraActions || secondaryActions.length);
  return (
    <>
      <header className={styles.header}>
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <div className={styles.titleRow}>
          <div className={styles.heading}>
            <div className={styles.titleLine}>
              <Heading className={styles.title}>{title}</Heading>
              {status}
            </div>
            {meta && meta.length > 0 && (
              <div className={styles.meta}>
                {meta.map((item, index) => (
                  <span key={index} className={styles.metaItem}>
                    {item}
                  </span>
                ))}
              </div>
            )}
            {description && <p className={styles.description}>{description}</p>}
          </div>
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
      </header>
      {alerts !== false && <PageAlerts>{alerts}</PageAlerts>}
    </>
  );
}
