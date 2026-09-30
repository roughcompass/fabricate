import { Icon, type IconName } from "./icon";
import styles from "./alert.module.css";

export type AlertTone = "info" | "success" | "warning" | "error";

const ICONS: Record<AlertTone, IconName> = { info: "info", success: "checkCircle", warning: "alert", error: "xCircle" };

interface AlertProps {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /** Announces the alert when it appears after the page loads, as for a failed launch. */
  live?: boolean;
}

/**
 * A condition of the record on this page that needs the operator's attention.
 * Alerts sit in the page-alert slot below the header, one per condition; they
 * never report a completed action (a toast does) or restate a status.
 */
export function Alert({ tone = "info", title, children, actions, live = false }: AlertProps) {
  return (
    <div className={styles.alert} data-tone={tone} role={live ? (tone === "error" ? "alert" : "status") : undefined}>
      <Icon name={ICONS[tone]} className={styles.icon} />
      <div className={styles.main}>
        <div className={styles.body}>
          <p className={styles.title}>{title}</p>
          {children && <div className={styles.content}>{children}</div>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}

/** The slot below the page header where page alerts appear, including those raised by client components. */
export function PageAlerts({ children }: { children?: React.ReactNode }) {
  return (
    <div id="page-alerts" className={styles.slot}>
      {children}
    </div>
  );
}
