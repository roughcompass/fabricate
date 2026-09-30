import { Icon, type IconName } from "./icon";
import type { Tone } from "./badge";
import styles from "./notice.module.css";

const ICONS: Record<Tone, IconName> = { neutral: "info", info: "info", success: "checkCircle", warning: "alert", error: "xCircle" };

interface NoticeProps {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  /** Announces the notice to assistive technology when it appears. */
  live?: boolean;
}

export function Notice({ tone = "info", title, children, live = false }: NoticeProps) {
  return (
    <div
      className={[styles.notice, tone !== "neutral" && styles[tone]].filter(Boolean).join(" ")}
      role={tone === "error" ? "alert" : live ? "status" : undefined}
      aria-live={live && tone !== "error" ? "polite" : undefined}
    >
      <Icon name={ICONS[tone]} size={16} className={styles.icon} />
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
