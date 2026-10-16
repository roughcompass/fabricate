import Link from "next/link";
import { Status } from "./status";
import styles from "./thread-view.module.css";

export interface ThreadItem {
  readonly id: string;
  /** What started this step: the generation's intent, a refinement message, a fork, or a template. */
  readonly kind: "generated" | "refined" | "forked" | "template";
  readonly text: string;
  /** The stage while it runs, "failed", or null once it produced its version. */
  readonly stage: string | null;
  /** What the generator said it did. */
  readonly summary: string | null;
  readonly failure: string | null;
  /** The version it produced. */
  readonly version: { readonly number: number; readonly href: string } | null;
}

const LEADS: Record<ThreadItem["kind"], string> = { generated: "Generated from", refined: "You asked", forked: "Forked", template: "Started from a template" };

/**
 * A prototype's thread (design.md, decision 15): each message with its
 * stage while it runs, the generator's summary, and the version it produced
 * as a chip that opens it. The version shown is marked current.
 */
export function ThreadView({ items, current }: { items: readonly ThreadItem[]; current: number | null }) {
  return (
    <ol className={styles.thread} aria-label="Thread">
      {items.map((item) => (
        <li key={item.id} className={styles.item} data-thread-item={item.kind}>
          <p className={styles.lead}>{LEADS[item.kind]}</p>
          <p className={styles.text}>{item.text}</p>
          {item.stage && <Status state={item.stage} size="sm" />}
          {item.failure && <p className={styles.failure}>{item.failure}</p>}
          {item.summary && <p className={styles.summary}>{item.summary}</p>}
          {item.version && (
            <Link href={item.version.href} className={styles.chip} aria-current={item.version.number === current ? "true" : undefined} data-version-chip={item.version.number}>
              {`v${item.version.number}`}
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}
