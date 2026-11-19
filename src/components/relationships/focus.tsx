import Link from "next/link";
import { EvidenceList } from "@/components/results/evidence";
import { ButtonLink } from "@/components/ui/button";
import { countLabel, formatNumber } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Status, edgeBasis } from "@/components/ui/status";
import type { Focus, FocusList } from "@/lib/relationships/levels";
import { signalSummary } from "./diagram";
import { EDGE_LABELS } from "./relationships-table";
import styles from "./relationships.module.css";

const KIND_LABELS: Record<Focus["kind"], string> = { repository: "Repository", service: "Service", package: "Package", node: "Endpoint" };

/**
 * What a change to a repository, service, or package affects (design
 * decisions 7 and 8). The sentence leads; the lists show direct
 * relationships, grouped by application and portal, and each row opens
 * its signals, evidence, and resolver rule.
 */
export function FocusPanel({ focus, assessmentId, closeHref, pageHref }: { focus: Focus; assessmentId: string; closeHref: string; pageHref: (list: "dependents" | "dependencies", page: number) => string }) {
  return (
    <Panel
      title={focus.label}
      description={KIND_LABELS[focus.kind]}
      actions={
        <div className={styles.actions}>
          {focus.profileHref && (
            <ButtonLink href={focus.profileHref} variant="secondary" size="sm">
              Profile
            </ButtonLink>
          )}
          <ButtonLink href={closeHref} variant="tertiary" size="sm" icon="x">
            Close focus
          </ButtonLink>
        </div>
      }
    >
      <p className={styles.sentence} data-focus-sentence="">
        {focus.sentence}
      </p>
      {focus.producer && (
        <p className={styles.muted}>
          {"Built by "}
          <Link href={focus.producer.href}>{focus.producer.label}</Link>
        </p>
      )}

      {focus.kind === "package" ? (
        <Declarations focus={focus} />
      ) : (
        <div className={styles.stack}>
          <RelationshipList title="Affected if it changes" empty={`Nothing in this Run depends on ${focus.label}.`} list={focus.dependents} evidence={focus.evidence} assessmentId={assessmentId} href={(page) => pageHref("dependents", page)} />
          <RelationshipList title="Depends on" empty={`${focus.label} depends on nothing else in this Run.`} list={focus.dependencies} evidence={focus.evidence} assessmentId={assessmentId} href={(page) => pageHref("dependencies", page)} />
        </div>
      )}

      {focus.thirdParty.length > 0 && (
        <Disclosure variant="plain" summary={`Depends on ${countLabel(focus.thirdParty.length, "third-party package")}`}>
          <ul className={styles.packages} aria-label="Third-party packages">
            {focus.thirdParty.map((item) => (
              <li key={item.name}>
                <Link href={item.href}>{item.name}</Link>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Panel>
  );
}

function RelationshipList({ title, empty, list, evidence, assessmentId, href }: { title: string; empty: string; list: FocusList; evidence: Focus["evidence"]; assessmentId: string; href: (page: number) => string }) {
  return (
    <section className={styles.list} aria-label={title}>
      <h3 className={styles.listTitle}>{`${title} (${formatNumber(list.total)})`}</h3>
      {list.total === 0 && <p className={styles.muted}>{empty}</p>}
      {list.groups.map((group) => (
        <div key={group.label} className={styles.group}>
          <h4 className={styles.groupLabel}>{group.label}</h4>
          <ul className={`${styles.rows} ${styles.divided}`}>
            {group.rows.map((row) => (
              <li key={row.nodeId ?? row.label}>
                <details className={styles.row}>
                  <summary>
                    {row.href ? <Link href={row.href}>{row.label}</Link> : <span>{row.label}</span>}
                    <span className={styles.muted}>{signalSummary(row.signals)}</span>
                    {row.state !== "resolved" && <Status state={row.state} size="sm" />}
                  </summary>
                  <ul className={styles.signals} aria-label={`Signals for ${row.label}`}>
                    {row.signals.map((signal) => (
                      <li key={signal.edgeId} className={styles.signal}>
                        <span>{`${EDGE_LABELS[signal.type]?.[0] ?? signal.type}, ${edgeBasis(signal.basis).toLowerCase()}`}</span>
                        <span className={styles.rule}>{signal.rule}</span>
                        <EvidenceList ids={signal.evidence} records={evidence} owner={{ run: assessmentId }} />
                      </li>
                    ))}
                    {row.reason && <li className={styles.muted}>{row.reason}</li>}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Pagination label={`${title} pages`} page={list.page} pages={list.pages} href={href} />
    </section>
  );
}

function Declarations({ focus }: { focus: Focus }) {
  if (focus.declarations.length === 0) return <p className={styles.muted}>No repository in this Run declares it.</p>;
  const groups: { label: string; rows: Focus["declarations"] }[] = [];
  for (const row of focus.declarations) {
    const last = groups.at(-1);
    if (last && last.label === row.group) last.rows.push(row);
    else groups.push({ label: row.group, rows: [row] });
  }
  return (
    <section className={styles.list} aria-label="Declared by">
      <h3 className={styles.listTitle}>{`Declared by (${formatNumber(new Set(focus.declarations.map((row) => row.label)).size)})`}</h3>
      {groups.map((group) => (
        <div key={group.label} className={styles.group}>
          <h4 className={styles.groupLabel}>{group.label}</h4>
          <ul className={`${styles.rows} ${styles.divided}`}>
            {group.rows.map((row) => (
              <li key={`${row.label}-${row.manifest}`} className={styles.declaration}>
                <Link href={row.href}>{row.label}</Link>
                <span className={styles.muted}>{[row.manifest !== "package.json" ? row.manifest : null, row.specifier ?? "Not declared", row.resolvedVersion ? `resolved ${row.resolvedVersion}` : "not resolved"].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
