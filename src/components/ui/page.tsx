import { PageAlerts } from "./alert";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { ButtonLink } from "./button";
import type { IconName } from "./icon";
import { Menu, MenuItem } from "./menu";
import styles from "./page.module.css";

/**
 * A page body: `content` for most pages, `form` for every create and edit
 * form. Each part is centered at the page's measure, with the gutters at its
 * edges. `busy` marks a loading skeleton. Pages don't use it directly: their
 * template does (src/components/templates/).
 */
export function Page({ width = "content", busy = false, children }: { width?: "content" | "form"; busy?: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.page} data-width={width} aria-busy={busy || undefined} aria-label={busy ? "Loading" : undefined}>
      {children}
    </div>
  );
}

/** The ten page templates (operator-interface/page-templates spec). */
export const TEMPLATES = ["dashboard", "index", "details", "analysis", "form", "flow", "editor", "settings", "content", "system"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export interface HeaderLink {
  label: string;
  href: string;
  icon?: IconName;
}

/** Everything a page header can hold besides its title, in the order it shows them. */
interface HeaderSlots {
  /** The record's ancestors, along one chain; top-level lists have none. */
  breadcrumbs?: readonly Crumb[];
  /** The record's state, beside the title. */
  status?: React.ReactNode;
  /** At most four short facts on one line, such as the parent and relevant times. */
  meta?: readonly React.ReactNode[];
  /** One sentence, at most. */
  description?: React.ReactNode;
  /** The page's single primary action, at the end of the title row. */
  primaryAction?: React.ReactNode;
  /** Other actions that navigate, at most three; on narrow screens they move into a menu when there is a primary action. */
  secondaryActions?: readonly HeaderLink[];
  /** Other actions that are not links, such as a confirmation dialog or an overflow menu; always visible. */
  extraActions?: React.ReactNode;
  /** The record's view tabs, the header's last child. */
  tabs?: React.ReactNode;
}

export type HeaderSlot = keyof HeaderSlots;

/**
 * The slots each template's page header shows (page-templates spec): every
 * header has its title, and only these besides. A template that names no
 * action slot takes no actions; System takes nothing but its title.
 */
export const HEADER_SLOTS = {
  dashboard: ["description", "primaryAction", "secondaryActions"],
  index: ["breadcrumbs", "description", "primaryAction", "secondaryActions", "extraActions"],
  details: ["breadcrumbs", "status", "meta", "description", "primaryAction", "secondaryActions", "extraActions", "tabs"],
  analysis: ["breadcrumbs", "meta", "description", "secondaryActions", "extraActions", "tabs"],
  form: ["breadcrumbs", "description"],
  flow: ["breadcrumbs", "description"],
  editor: ["breadcrumbs", "status", "meta", "description", "secondaryActions", "extraActions"],
  settings: ["breadcrumbs", "description"],
  content: ["breadcrumbs", "description", "secondaryActions", "extraActions"],
  system: [],
} as const satisfies Record<TemplateName, readonly HeaderSlot[]>;

/** The header slots template +T+ shows. */
export type TemplateHeader<T extends TemplateName> = { title: string } & Pick<HeaderSlots, (typeof HEADER_SLOTS)[T][number]>;

export type PageHeaderProps<T extends TemplateName = TemplateName> = TemplateHeader<T> & {
  /** The page's template, which fixes the slots its header shows. */
  template: T;
  /** Conditions that need attention, shown in the page-alert slot below the header; `false` omits the slot, as in the gallery's specimens. */
  alerts?: React.ReactNode | false;
  /** 1 for a page; 3 for the gallery's specimens, which sit under the gallery's own headings. */
  headingLevel?: 1 | 3;
};

const shows = (template: TemplateName, slot: HeaderSlot) => (HEADER_SLOTS[template] as readonly HeaderSlot[]).includes(slot);

/**
 * The top of a page (operator-interface/page-patterns spec), in a fixed
 * order: breadcrumbs; the title row, with the page's title as its only `h1`,
 * its status beside it, and its actions at the row's end; the meta row; the
 * description; and the view tabs, last. Its `template` fixes which of them
 * show (HEADER_SLOTS), so pages of one template share one anatomy. The
 * page-alert slot follows the header.
 */
export function PageHeader<T extends TemplateName>(props: PageHeaderProps<T>) {
  const { template, title, alerts, headingLevel = 1 } = props;
  const slots = props as HeaderSlots;
  const pick = <K extends HeaderSlot>(slot: K): HeaderSlots[K] | undefined => (shows(template, slot) ? slots[slot] : undefined);
  const breadcrumbs = pick("breadcrumbs");
  const status = pick("status");
  const meta = pick("meta");
  const description = pick("description");
  const primaryAction = pick("primaryAction");
  const secondaryActions = pick("secondaryActions") ?? [];
  const extraActions = pick("extraActions");
  const tabs = pick("tabs");

  const Heading = headingLevel === 3 ? "h3" : "h1";
  const collapse = Boolean(primaryAction) && secondaryActions.length > 0;
  const hasActions = Boolean(primaryAction || extraActions || secondaryActions.length);

  return (
    <>
      <header className={styles.header} data-page-header="" data-template={template}>
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <div className={styles.titleRow}>
          <div className={styles.titleLine}>
            <Heading className={styles.title} title={title}>
              {title}
            </Heading>
            {status && (
              <span className={styles.status} data-header-status="">
                {status}
              </span>
            )}
          </div>
          {hasActions && (
            <div className={styles.actions} data-header-actions="">
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
        {meta && meta.length > 0 && (
          <div className={styles.meta} data-header-meta="">
            {meta.map((item, index) => (
              <span key={index} className={styles.metaItem} data-meta-item="">
                {item}
              </span>
            ))}
          </div>
        )}
        {description && (
          <p className={styles.description} data-header-description="">
            {description}
          </p>
        )}
        {tabs && (
          <div className={styles.tabs} data-header-tabs="">
            {tabs}
          </div>
        )}
      </header>
      {alerts !== false && <PageAlerts>{alerts}</PageAlerts>}
    </>
  );
}
