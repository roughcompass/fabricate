import { Icon, type IconName } from "@/components/ui/icon";
import { Page, PageHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, type SpecimenOption, Zone } from "./parts";
import styles from "./templates.module.css";

interface SystemProps extends SpecimenOption {
  /** Names the condition, such as "Run not found". */
  title: string;
  icon?: IconName;
  /** One sentence; an error may add the reference that matches the server log. */
  children: React.ReactNode;
  /** One way back to the nearest list, and Try again for errors. */
  actions: React.ReactNode;
}

/**
 * System (page-templates spec): a condition, such as a missing record, an
 * error, or an unavailable area. The page header holds only a title naming
 * the condition, with no breadcrumbs, meta row, or view tabs; a status block
 * follows with one sentence and one way back. Modeled on Salt's content
 * status and Cloudscape's empty states.
 */
export function SystemTemplate({ title, icon = "help", children, actions, specimen }: SystemProps) {
  return (
    <Page>
      <PageHeader template="system" title={title} alerts={false} headingLevel={specimen ? 3 : 1} />
      <Zone name="status" className={styles.status}>
        <span className={styles.statusIcon}>
          <Icon name={icon} size={20} />
        </span>
        <div className={styles.statusText}>{children}</div>
        <div className={styles.statusActions}>{actions}</div>
      </Zone>
    </Page>
  );
}

/** A System page while it loads: its title and the status block. */
export function SystemSkeleton() {
  return (
    <Page busy>
      <HeaderSkeleton />
      <div className={styles.status}>
        <Skeleton width="long" />
        <Skeleton width="short" height="control" />
      </div>
    </Page>
  );
}
