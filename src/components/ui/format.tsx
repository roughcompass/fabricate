import styles from "./layout.module.css";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** A timestamp in UTC with its ISO form available on hover and to machines. */
export function Timestamp({ value }: { value: Date | null | undefined }) {
  if (!value) return <span className={styles.muted}>—</span>;
  const iso = value.toISOString();
  return (
    <time dateTime={iso} title={iso}>
      {dateFormat.format(value)} UTC
    </time>
  );
}

export function ShortSha({ sha }: { sha: string }) {
  return (
    <code className={styles.mono} title={sha}>
      {sha.slice(0, 12)}
    </code>
  );
}

export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : plural}`;
}
