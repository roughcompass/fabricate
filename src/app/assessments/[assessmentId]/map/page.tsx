import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceList } from "@/components/results/evidence";
import styles from "@/components/results/results.module.css";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/format";
import { Select } from "@/components/ui/form";
import { Card, EmptyState, Page, PageHeader, Stat, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { findAssessment } from "@/lib/assessments/assessment-records";
import { getDb } from "@/lib/db/client";
import { profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import { EDGE_TYPES, type EdgeType, type MapDocument, type MapEdge, type MapNode, NODE_KINDS, type NodeKind, RESOLUTION_STATES } from "@/lib/relationships/schema";

export const metadata: Metadata = { title: "Relationship Map" };

const KIND_PLURALS: Record<NodeKind, string> = {
  repository: "Repositories",
  package: "Packages",
  external_service: "External services",
  out_of_scope_source: "Out-of-scope sources",
  unresolved_endpoint: "Unresolved endpoints",
};

const KIND_LABELS: Record<NodeKind, string> = {
  repository: "Repository",
  package: "Package",
  external_service: "External service",
  out_of_scope_source: "Out-of-scope source",
  unresolved_endpoint: "Unresolved endpoint",
};

/** Each edge reads from its declaring repository: "orders depends on @acme/client". */
const EDGE_LABELS: Record<EdgeType, [label: string, verb: string]> = {
  package_dependency: ["Package dependency", "depends on"],
  package_production: ["Package production", "produces"],
  composition: ["Composition", "composes"],
  iframe: ["Iframe", "embeds"],
  runtime_contract: ["Runtime contract", "exchanges a runtime contract with"],
  service_call: ["Service call", "calls"],
};

const DIRECTIONS = ["either", "outgoing", "incoming"] as const;

function nodeLabel(node: MapNode): string {
  switch (node.kind) {
    case "repository":
    case "out_of_scope_source":
      return node.source.name;
    case "package":
      return node.name;
    case "external_service":
      return node.key;
    case "unresolved_endpoint":
      return Object.values(node.reference.identifier).join(" ") || node.reference.type;
  }
}

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function MapPage({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const assessment = findAssessment(db, assessmentId);
  if (!assessment) notFound();
  const base = `/assessments/${assessment.publicId}/map`;
  const back = { href: `/assessments/${assessment.publicId}`, label: `Assessment ${assessment.publicId}` };
  const record = mapOf(db, assessment.id);
  if (!record) {
    return (
      <Page>
        <PageHeader title="Relationship Map" back={back} />
        <EmptyState title="No Relationship Map yet">The map is written once every scoped repository has finished, from the Profiles that completed.</EmptyState>
      </Page>
    );
  }

  const map = mapDocument(record) as unknown as MapDocument;
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  const profiles = new Map(profilesOf(db, assessment.id).map(({ profile, target }) => [target.publicId, profile.publicId]));
  const filters = {
    node: typeof query.node === "string" && nodes.has(query.node) ? query.node : undefined,
    direction: pick(query.direction, DIRECTIONS) ?? "either",
    type: pick(query.type, EDGE_TYPES),
    state: pick(query.state, RESOLUTION_STATES),
  };
  const touches = (edge: MapEdge, node: string, direction: (typeof DIRECTIONS)[number]) =>
    (direction !== "incoming" && edge.from === node) || (direction !== "outgoing" && (edge.to === node || edge.candidates.includes(node)));
  const edges = map.edges.filter((edge) => (!filters.node || touches(edge, filters.node, filters.direction)) && (!filters.type || edge.type === filters.type) && (!filters.state || edge.state === filters.state));
  const filtered = Boolean(filters.node || filters.type || filters.state);
  // Reading order: by declaring repository, then relationship type, then what it refers to.
  const target = (edge: MapEdge) => (edge.to ? nodeLabel(nodes.get(edge.to)!) : edge.candidates.map((id) => nodeLabel(nodes.get(id)!)).join(" "));
  edges.sort((a, b) => nodeLabel(nodes.get(a.from)!).localeCompare(nodeLabel(nodes.get(b.from)!)) || EDGE_TYPES.indexOf(a.type) - EDGE_TYPES.indexOf(b.type) || target(a).localeCompare(target(b)));
  const sortedNodes = [...map.nodes].sort((a, b) => NODE_KINDS.indexOf(a.kind) - NODE_KINDS.indexOf(b.kind) || nodeLabel(a).localeCompare(nodeLabel(b)));

  const nodeLink = (id: string) => {
    const node = nodes.get(id)!;
    const label = nodeLabel(node);
    if (node.kind === "repository" && profiles.has(node.target)) return <Link href={`/profiles/${profiles.get(node.target)}`}>{label}</Link>;
    return node.kind === "repository" ? label : <Mono>{label}</Mono>;
  };
  const filterHref = (node: string, direction: (typeof DIRECTIONS)[number]) => `${base}?${new URLSearchParams({ node, direction })}#relationships`;

  return (
    <Page>
      <PageHeader title="Relationship Map" back={back} description="Directional relationships among this Assessment's repositories, resolved from the references in their Profiles. The map never changes after it is written." />

      {map.coverage.complete ? (
        <Notice tone="success">Every scoped repository contributed its references.</Notice>
      ) : (
        <Notice tone="warning" title={`${countLabel(map.coverage.gaps.length, "repository", "repositories")} did not contribute`}>
          Relationships those repositories declare are missing from this map, and an unresolved reference might belong to one of them. Evaluations treat what they could hold as unknown.
        </Notice>
      )}

      <Card title="Node summary" description="Everything the relationships connect, by kind. Repositories that were not assessed are coverage gaps.">
        <div className={ui.stats}>
          {NODE_KINDS.map((kind) => (
            <Stat key={kind} label={KIND_PLURALS[kind]} value={map.nodes.filter((node) => node.kind === kind).length} />
          ))}
          <Stat label="Coverage gaps" value={map.coverage.gaps.length} />
        </div>
      </Card>

      {map.coverage.gaps.length > 0 && (
        <Card title="Coverage gaps" flush>
          <Table
            label="Coverage gaps"
            head={
              <>
                <Th>Repository</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
              </>
            }
          >
            {map.coverage.gaps.map((gap) => (
              <tr key={gap.target}>
                <Td label="Repository">
                  <Primary>{gap.source.name}</Primary>
                  <Secondary mono>{gap.source.public_id}</Secondary>
                </Td>
                <Td label="Status">
                  <StatusBadge state={gap.state} />
                </Td>
                <Td label="Reason">{gap.reason ? <Mono>{gap.reason}</Mono> : <span className={ui.muted}>{gap.state === "canceled" ? "Canceled before it finished" : "Not recorded"}</span>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Nodes" flush>
        <Table
          label="Nodes"
          head={
            <>
              <Th>Node</Th>
              <Th>Kind</Th>
              <Th align="numeric">Outgoing</Th>
              <Th align="numeric">Incoming</Th>
            </>
          }
        >
          {sortedNodes.map((node) => {
            const outgoing = map.edges.filter((edge) => touches(edge, node.id, "outgoing")).length;
            const incoming = map.edges.filter((edge) => touches(edge, node.id, "incoming")).length;
            const label = nodeLabel(node);
            return (
              <tr key={node.id}>
                <Td label="Node">
                  <span className={styles.value}>{nodeLink(node.id)}</span>
                  {node.kind === "out_of_scope_source" && <Secondary>In the catalog but not in this Assessment; not analyzed</Secondary>}
                </Td>
                <Td label="Kind">{KIND_LABELS[node.kind]}</Td>
                <Td label="Outgoing" align="numeric">
                  {outgoing ? <Link href={filterHref(node.id, "outgoing")} aria-label={`${outgoing} outgoing from ${label}`}>{outgoing}</Link> : 0}
                </Td>
                <Td label="Incoming" align="numeric">
                  {incoming ? <Link href={filterHref(node.id, "incoming")} aria-label={`${incoming} incoming to ${label}`}>{incoming}</Link> : 0}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div id="relationships">
        <Card title="Relationships" description="Each row reads from the repository that declared the reference to what it refers to." flush>
          <div className={styles.cardSection}>
          {/* Keyed by the filters so a navigation between filtered views resets the uncontrolled controls. */}
          <form key={JSON.stringify(filters)} method="get" action={base} className={styles.filters} aria-label="Filter relationships">
            <Select
              id="filter-node"
              name="node"
              label="Node"
              defaultValue={filters.node ?? ""}
              options={[{ value: "", label: "Any node" }, ...sortedNodes.map((node) => ({ value: node.id, label: `${nodeLabel(node)} (${KIND_LABELS[node.kind].toLowerCase()})` }))]}
            />
            <Select
              id="filter-direction"
              name="direction"
              label="Direction"
              defaultValue={filters.direction}
              options={[
                { value: "either", label: "Either direction" },
                { value: "outgoing", label: "Outgoing from the node" },
                { value: "incoming", label: "Incoming to the node" },
              ]}
            />
            <Select id="filter-type" name="type" label="Relationship type" defaultValue={filters.type ?? ""} options={[{ value: "", label: "Any type" }, ...EDGE_TYPES.map((type) => ({ value: type, label: EDGE_LABELS[type][0] }))]} />
            <Select
              id="filter-state"
              name="state"
              label="Resolution state"
              defaultValue={filters.state ?? ""}
              options={[{ value: "", label: "Any state" }, ...RESOLUTION_STATES.map((state) => ({ value: state, label: state === "out_of_scope" ? "Out of scope" : state[0]!.toUpperCase() + state.slice(1) }))]}
            />
            <div className={styles.filterActions}>
              <Button type="submit" variant="primary">
                Apply filters
              </Button>
              {filtered && <ButtonLink href={`${base}#relationships`}>Clear filters</ButtonLink>}
            </div>
          </form>
          <p role="status">{filtered ? `Showing ${edges.length} of ${countLabel(map.edges.length, "relationship")}` : `${countLabel(map.edges.length, "relationship")}`}</p>
          {edges.length === 0 && <p className={ui.muted}>{filtered ? "No relationship matches these filters." : "No repository declared a relationship."}</p>}
          </div>
          {edges.length > 0 && (
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
              {edges.map((edge) => (
                <tr key={edge.id}>
                  <Td label="From">{nodeLink(edge.from)}</Td>
                  <Td label="Relationship">
                    {EDGE_LABELS[edge.type][1]}
                    <Secondary>{`${EDGE_LABELS[edge.type][0]}, ${edge.basis}`}</Secondary>
                  </Td>
                  <Td label="To">
                    {edge.to ? (
                      <span className={styles.value}>{nodeLink(edge.to)}</span>
                    ) : (
                      <>
                        One of:
                        <ul className={styles.candidates} aria-label="Candidates">
                          {[...edge.candidates].sort((a, b) => nodeLabel(nodes.get(a)!).localeCompare(nodeLabel(nodes.get(b)!))).map((candidate) => (
                            <li key={candidate} className={styles.value}>
                              {nodeLink(candidate)}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Td>
                  <Td label="State">
                    <StatusBadge state={edge.state} />
                    {edge.reason && <Secondary>{edge.reason}</Secondary>}
                    {edge.state === "unresolved" && !map.coverage.complete && <Secondary>A repository that was not assessed might resolve it.</Secondary>}
                  </Td>
                  <Td label="Evidence">
                    <EvidenceList ids={edge.evidence} records={map.evidence} assessmentId={assessment.publicId} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </Page>
  );
}
