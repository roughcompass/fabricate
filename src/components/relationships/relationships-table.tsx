import Link from "next/link";
import { EvidenceList } from "@/components/results/evidence";
import { countLabel, formatNumber } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status, edgeBasis } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { PAGE_SIZE, type RelationshipPage, type RelationshipRow } from "@/lib/relationships/levels";
import styles from "./relationships.module.css";

/** Each edge reads from its declaring repository: "orders depends on @acme/client". */
export const EDGE_LABELS: Record<string, [label: string, verb: string]> = {
  package_dependency: ["Package dependency", "depends on"],
  package_production: ["Package production", "produces"],
  composition: ["Composition", "composes"],
  iframe: ["Iframe", "embeds"],
  runtime_contract: ["Runtime contract", "exchanges a runtime contract with"],
  service_call: ["Service call", "calls"],
};

type Endpoint = NonNullable<RelationshipRow["to"]>;

/**
 * The relationships of the current group or focus, one page at a time
 * (design decision 10). Repositories and services link to their focus;
 * every row keeps its evidence one step away.
 */
export function RelationshipsTable({
  page,
  runId,
  focusHref,
  packageHref,
  pageHref,
  coverageComplete,
  description,
}: {
  page: RelationshipPage;
  runId: string;
  focusHref: (nodeId: string) => string;
  /** The focus of a package, for the third-party packages left out of the rows. */
  packageHref: (name: string) => string;
  pageHref: (page: number) => string;
  coverageComplete: boolean;
  description: string;
}) {
  const node = (endpoint: Endpoint) => (endpoint.kind === "repository" || endpoint.kind === "external_service" ? <Link href={focusHref(endpoint.nodeId)}>{endpoint.label}</Link> : <Tag>{endpoint.label}</Tag>);
  const first = (page.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page.total, page.page * PAGE_SIZE);
  return (
    <Section title="Relationships" description={description}>
      <p role="status" className={styles.count}>
        {page.pages > 1 ? `${formatNumber(first)}–${formatNumber(last)} of ${countLabel(page.total, "relationship")}` : countLabel(page.total, "relationship")}
      </p>
      <Panel flush>
        {page.rows.length > 0 ? (
          <Table
            label="Relationships"
            head={
              <>
                <Th>From</Th>
                <Th>Relationship</Th>
                <Th>To</Th>
                <Th>State</Th>
                <Th>Evidence</Th>
              </>
            }
          >
            {page.rows.map((row) => (
              <tr key={row.edgeId}>
                <Td label="From">{node(row.from)}</Td>
                <Td label="Relationship">
                  {EDGE_LABELS[row.type]?.[1] ?? row.type}
                  <Secondary>{`${EDGE_LABELS[row.type]?.[0] ?? row.type}, ${edgeBasis(row.basis).toLowerCase()}`}</Secondary>
                </Td>
                <Td label="To">
                  {row.to ? (
                    node(row.to)
                  ) : (
                    <>
                      One of:
                      <ul className={styles.candidates} aria-label="Candidates">
                        {row.candidates.map((candidate) => (
                          <li key={candidate.nodeId}>
                            <Link href={focusHref(candidate.nodeId)}>{candidate.label}</Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Td>
                <Td label="State">
                  <Status state={row.state} />
                  {row.reason && <Secondary>{row.reason}</Secondary>}
                  {row.state === "unresolved" && !coverageComplete && <Secondary>A repository that was not assessed might resolve it.</Secondary>}
                </Td>
                <Td label="Evidence">
                  <EvidenceList ids={row.evidence} records={page.evidence} owner={{ run: runId }} of={`${row.from.label} ${EDGE_LABELS[row.type]?.[1] ?? row.type} ${row.to?.label ?? `one of ${row.candidates.map((candidate) => candidate.label).join(", ")}`}`} />
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No relationships">{page.thirdParty.length ? "Every dependency here is a third-party package, listed below." : "No repository here declared a relationship."}</EmptyState>
        )}
      </Panel>
      <Pagination label="Relationships pages" page={page.page} pages={page.pages} href={pageHref} />
      {page.thirdParty.length > 0 && (
        <Disclosure variant="plain" summary={`And ${countLabel(page.thirdParty.length, "third-party package")}, which no repository in this Run produces`}>
          {!coverageComplete && <p className={styles.muted}>A repository that was not assessed might produce some of them.</p>}
          <ul className={styles.packages} aria-label="Third-party packages">
            {page.thirdParty.map((item) => (
              <li key={item.name}>
                <Link href={packageHref(item.name)}>{item.name}</Link> <span className={styles.muted}>{`declared by ${countLabel(item.dependents, "repository", "repositories")}`}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Section>
  );
}
