import Link from "next/link";
import { buttonClass } from "@/components/ui/button-content";
import { Icon, type IconName } from "@/components/ui/icon";
import styles from "./system-page.module.css";

interface SystemPageProps {
  icon: IconName;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}

/** A centered message inside the application shell, for not-found and error states. */
export function SystemPage({ icon, title, children, actions }: SystemPageProps) {
  return (
    <div className={styles.page}>
      <span className={styles.icon}>
        <Icon name={icon} size={20} />
      </span>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.text}>{children}</div>
      <div className={styles.actions}>{actions}</div>
    </div>
  );
}

/**
 * A record that does not exist, with a link to the list of its section.
 * `sentenceNoun` is the noun mid-sentence, for nouns that are not capitalized domain terms.
 */
export function NotFoundPage({ noun, listHref, listLabel, sentenceNoun }: { noun: string; listHref: string; listLabel: string; sentenceNoun?: string }) {
  return (
    <SystemPage
      icon="help"
      title={`${noun} not found`}
      actions={
        <Link href={listHref} className={buttonClass("primary")}>
          {`Go to ${listLabel}`}
        </Link>
      }
    >
      <p>{`This ${sentenceNoun ?? (noun === "Page" ? "page" : noun)} does not exist. It may have been deleted, or the address may be mistyped.`}</p>
    </SystemPage>
  );
}
