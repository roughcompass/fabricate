import Link from "next/link";
import { buttonProps } from "@/components/ui/button-content";
import { Icon, type IconName } from "@/components/ui/icon";
import { Page } from "@/components/ui/page";
import { ShellHeader } from "./shell-header";
import styles from "./system-page.module.css";

interface SystemPageProps {
  icon: IconName;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}

/**
 * A not-found or error state inside the application shell: its title in the
 * shell header, like every page's, and a centered message on a content
 * surface below it.
 */
export function SystemPage({ icon, title, children, actions }: SystemPageProps) {
  return (
    <Page>
      <ShellHeader title={title} />
      <div className={styles.message}>
        <span className={styles.icon}>
          <Icon name={icon} size={20} />
        </span>
        <div className={styles.text}>{children}</div>
        <div className={styles.actions}>{actions}</div>
      </div>
    </Page>
  );
}

/**
 * A record that does not exist, with a link to the list of its section.
 * `sentenceNoun` is the noun mid-sentence, for nouns that are not capitalized
 * domain terms. A demo page passes `demo`, the demo setting: while the demo is
 * disabled the whole area is unavailable, so the page names no record and
 * links to the Assessments list, never back to a page that is itself not
 * found (page-patterns spec, not-found states).
 */
export function NotFoundPage({ noun, listHref, listLabel, sentenceNoun, demo = true }: { noun: string; listHref: string; listLabel: string; sentenceNoun?: string; demo?: boolean }) {
  if (!demo) return <NotFoundPage noun="Page" listHref="/assessments" listLabel="Assessments" />;
  return (
    <SystemPage
      icon="help"
      title={`${noun} not found`}
      actions={
        <Link href={listHref} {...buttonProps("primary")}>
          {`Go to ${listLabel}`}
        </Link>
      }
    >
      <p>{`This ${sentenceNoun ?? (noun === "Page" ? "page" : noun)} does not exist. It may have been deleted, or the address may be mistyped.`}</p>
    </SystemPage>
  );
}
