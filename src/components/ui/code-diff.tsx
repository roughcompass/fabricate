import type { FileDiff } from "@/lib/prototypes/diff";
import styles from "./code-diff.module.css";

const MARKS = { same: " ", added: "+", removed: "−" } as const;
const NAMES = { same: "Unchanged", added: "Added", removed: "Removed" } as const;

/**
 * The line differences between two versions of a file: a count of added and
 * removed lines, then each changed region with a few lines of context. Each
 * line carries its numbers in both versions, and added and removed lines are
 * named for assistive technology as well as marked and tinted.
 */
export function CodeDiff({ diff, before, after }: { diff: FileDiff; before: string; after: string }) {
  const unchanged = !diff.tooLarge && diff.hunks.length === 0;
  return (
    <figure className={styles.block} aria-label={`${diff.path}: ${before} to ${after}`} data-panel="" data-code-diff={diff.path}>
      <figcaption className={styles.caption}>
        <span className={styles.label}>{diff.path}</span>
        <span className={styles.counts} data-diff-counts="">
          {diff.tooLarge ? "Too long to compare line by line" : unchanged ? "No changes" : `${diff.added} added, ${diff.removed} removed`}
        </span>
      </figcaption>
      {diff.hunks.map((hunk, index) => (
        <pre key={index} className={styles.hunk}>
          <code>
            {hunk.map((line, position) => (
              <span key={position} className={styles.line} data-kind={line.kind}>
                <span className={styles.number} aria-hidden="true">
                  {line.before ?? ""}
                </span>
                <span className={styles.number} aria-hidden="true">
                  {line.after ?? ""}
                </span>
                <span className={styles.mark} aria-hidden="true">
                  {MARKS[line.kind]}
                </span>
                {line.kind !== "same" && <span className="visually-hidden">{`${NAMES[line.kind]}: `}</span>}
                <span className={styles.text}>{line.text}</span>
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
      ))}
    </figure>
  );
}
