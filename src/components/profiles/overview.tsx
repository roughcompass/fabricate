import Link from "next/link";
import { NoValuePlaceholder } from "@/components/results/no-value";
import { Alert } from "@/components/ui/alert";
import { DescriptionList } from "@/components/ui/description-list";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { Status, spaced, statusLabel } from "@/components/ui/status";
import type { OverviewRow, OverviewValue } from "@/lib/profiles/overview";
import type { SummaryPanel } from "@/lib/profiles/summary";
import { PROFILE_TABS, profileSectionHref, profileTabHref } from "@/lib/profiles/tabs";
import type { ProfileView } from "@/lib/profiles/view";
import { NeedsAttention } from "./attention";
import styles from "./profile.module.css";

/**
 * The Profile's first view: its scope as key figures, what needs attention,
 * then one panel per question, each answering it in a few rows whose values
 * carry their state and link to the facts behind them, with the way to the
 * view that holds them all. A repository that isn't a frontend web repository
 * is named as such first, with what decided it, and gets only the panels
 * that apply to any repository.
 */
export function ProfileOverview({ view, panels, base }: { view: ProfileView; panels: readonly SummaryPanel[]; base: string }) {
  const { kind } = view;
  return (
    <Section id="overview" title="Overview">
      {!kind.frontend && (
        <Alert tone="info" title="Not a frontend web repository">
          {`No UI framework, UI elements, composition mechanism, browser bundler, or markup was found${kind.languages.length ? `; its main languages are ${kind.languages.join(", ")}` : ""}. The Composition and Design system views apply only to frontend web repositories, so they're left out; its dependencies, services, and tooling are below.`}
        </Alert>
      )}
      <StatGroup label="Scope" stats={view.scope.map((figure) => ({ label: figure.label, value: figure.value, hint: figure.hint, href: figure.section ? profileSectionHref(base, figure.section) : undefined }))} />
      <NeedsAttention attention={view.attention} base={base} limit={5} />
      <div className={styles.panels}>
        {panels.map((panel) => {
          const tab = PROFILE_TABS.find((candidate) => candidate.id === panel.tab)!;
          return (
            <Panel
              key={panel.title}
              level={3}
              title={panel.title}
              actions={panel.tab === "overview" ? undefined : <Link href={profileTabHref(base, panel.tab)} className={styles.panelLink}>{`Open ${tab.label}`}</Link>}
            >
              <DescriptionList items={panel.rows.map((row) => [row.label, <OverviewValues key={row.label} row={row} base={base} />])} />
            </Panel>
          );
        })}
      </div>
    </Section>
  );
}

/** A row's values, each its own item in the row and a link to its facts, then how many more there are, or why there are none. */
export function OverviewValues({ row, base }: { row: OverviewRow; base: string }) {
  const href = profileSectionHref(base, row.category);
  return (
    // Each value is its own item in the row; spaced() keeps them apart in copied and spoken text too.
    <span className={row.stacked ? `${styles.values} ${styles.stacked}` : styles.values}>
      {spaced([
        row.summary && <span key="summary" className={styles.summary}>{row.summary}</span>,
        ...row.values.map((value, index) => (
          <Linked key={`value-${index}`} href={value.href ?? href}>
            <Value value={value} />
          </Linked>
        )),
        row.more > 0 && (
          <Linked key="more" href={href}>
            <span className={styles.more}>{`+${row.more} more`}</span>
          </Linked>
        ),
        ...row.placeholders.map((placeholder, index) => (
          <Linked key={`placeholder-${index}`} href={href}>
            {placeholder.label && <span className={styles.valueText}>{`${placeholder.label}:`}</span>}
            <NoValuePlaceholder value={placeholder.value} />
          </Linked>
        )),
        row.partial && (
          <Linked key="partial" href={href}>
            <Status state="partial" size="sm" label="Partial: some inputs weren't read" />
          </Linked>
        ),
      ])}
    </span>
  );
}

function Value({ value }: { value: OverviewValue }) {
  return (
    <Status state={value.state}>
      <span className={styles.valueText}>{value.text}</span>
      {value.secondary && <span className={styles.secondary}>{value.secondary}</span>}
      {value.state === "observed" ? <span className="visually-hidden">{`, ${statusLabel(value.state)}`}</span> : <span className={styles.secondary}>{statusLabel(value.state)}</span>}
    </Status>
  );
}

function Linked({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={styles.value}>
      {children}
    </a>
  );
}
