import { NoValuePlaceholder } from "@/components/results/no-value";
import { DescriptionList } from "@/components/ui/description-list";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import type { OverviewRow, OverviewValue } from "@/lib/profiles/overview";
import styles from "./profile.module.css";

/**
 * What the repository is, first: fixed rows whose values each carry their
 * state and link to their category. An observed value names its state for
 * assistive technology only; any other state is shown.
 */
export function ProfileOverview({ rows }: { rows: readonly OverviewRow[] }) {
  return (
    <Section id="overview" title="Overview">
      <DescriptionList surface items={rows.map((row) => [row.label, <OverviewValues key={row.label} row={row} />])} />
    </Section>
  );
}

function OverviewValues({ row }: { row: OverviewRow }) {
  const href = row.category ? `#${row.category}` : undefined;
  return (
    <span className={row.stacked ? `${styles.values} ${styles.stacked}` : styles.values}>
      {row.summary && <span className={styles.summary}>{row.summary}</span>}
      {row.values.map((value, index) => (
        <Linked key={index} href={href}>
          <Value value={value} />
        </Linked>
      ))}
      {row.more > 0 && (
        <Linked href={href}>
          <span className={styles.more}>{`+${row.more} more`}</span>
        </Linked>
      )}
      {row.placeholders.map((placeholder, index) => (
        <Linked key={`placeholder-${index}`} href={href}>
          {placeholder.label && <span className={styles.valueText}>{`${placeholder.label}:`}</span>}
          <NoValuePlaceholder value={placeholder.value} />
        </Linked>
      ))}
      {row.partial && (
        <Linked href={href}>
          <Status state="partial" size="sm" label="Partial: some inputs weren't read" />
        </Linked>
      )}
    </span>
  );
}

function Value({ value }: { value: OverviewValue }) {
  const text = (
    <>
      <span className={styles.valueText}>{value.text}</span>
      {value.secondary && <span className={styles.secondary}>{value.secondary}</span>}
    </>
  );
  if (value.state === null) return text;
  return (
    <Status state={value.state}>
      {text}
      {value.state === "observed" ? <span className="visually-hidden">{`, ${statusLabel(value.state)}`}</span> : <span className={styles.secondary}>{statusLabel(value.state)}</span>}
    </Status>
  );
}

function Linked({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  return href ? (
    <a href={href} className={styles.value}>
      {children}
    </a>
  ) : (
    <span className={styles.value}>{children}</span>
  );
}
