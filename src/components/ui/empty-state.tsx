import { Icon, type IconName } from "./icon";
import styles from "./empty-state.module.css";

/**
 * What an empty list or area holds: a title, one sentence, and the action that
 * fills it. It renders inside the panel or list it replaces, with no border of its own.
 */
export function EmptyState({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: IconName }) {
  return (
    <div className={styles.empty}>
      {icon && (
        <span className={styles.icon}>
          <Icon name={icon} size={20} />
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
