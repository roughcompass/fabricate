import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EvidenceList } from "@/components/results/evidence";
import { Alert } from "@/components/ui/alert";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { Status, edgeBasis, statusLabel } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { assessmentNumber, findAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { getDb } from "@/lib/db/client";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import { EDGE_TYPES, type EdgeType, type MapDocument, type MapEdge, type MapNode, NODE_KINDS, type NodeKind, RESOLUTION_STATES } from "@/lib/relationships/schema";
import styles from "./map.module.css";

const KIND_PLURALS: Record<NodeKind, string> = {
  repository: "Repositories",
  package: "Packages",
  external_service: "External services",
  out_of_scope_source: "Out-of-scope Repositories",
  unresolved_endpoint: "Unresolved endpoints",
};

const KIND_LABELS: Record<NodeKind, string> = {
  repository: "Repository",
  package: "Package",
  external_service: "External service",
  out_of_scope_source: "Out-of-scope Repository",
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

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const load = cache((publicId: string) => {
  const db = getDb();
  const assessment = findAssessment(db, publicId);
  if (!assessment) return undefined;
  return { assessment, initiative: initiativeById(db, assessment.initiativeId), number: assessmentNumber(db, assessment) };
});

export async function generateMetadata({ params }: { params: Promise<{ assessmentId: string }> }): Promise<Metadata> {
  const found = load((await params).assessmentId);
  return { title: found ? `Relationship Map · Run #${found.number}` : "Run not found" };
}

export default async function MapPage({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = load(assessmentId);
  if (!found) notFound();
  const { assessment, initiative, number } = found;
  const base = `/runs/${assessment.publicId}/map`;
  const breadcrumbs = [
    { href: "/assessments", label: "Assessments" },
    { href: `/assessments/${initiative.publicId}`, label: initiative.name },
    { href: `/runs/${assessment.publicId}`, label: `Run #${number}` },
  ];
  const record = mapOf(db, assessment.id);
  if (!record) {
    return (
      <Page>
        <PageHeader breadcrumbs={breadcrumbs} title="Relationship Map" />
        <Panel flush>
          <EmptyState title="No Relationship Map yet" icon="network">
            The map is written once every scoped repository has finished, from the Profiles that completed.
          </EmptyState>
        </Panel>
      </Page>
    );
  }

  const map = mapDocument(record) as unknown as MapDocument;
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  const profiles = new Map(profilesOf(db, assessment.id).map(({ profile, target }) => [target.publicId, profile.publicId]));
  // The map records each gap's failure code; the target keeps the readable message shown beside it.
  const failures = new Map(targetsOf(db, assessment.id).flatMap((target) => (target.failureMessage ? [[target.publicId, target.failureMessage] as const] : [])));
  const view = param(query, "view") === "nodes" ? "nodes" : "relationships";
  const filters = {
    node: (() => {
      const node = param(query, "node");
      return node && nodes.has(node) ? node : undefined;
    })(),
    direction: pick(param(query, "direction"), DIRECTIONS) ?? "either",
    type: pick(param(query, "type"), EDGE_TYPES),
    state: pick(param(query, "state"), RESOLUTION_STATES),
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
    return node.kind === "repository" ? label : <Tag>{label}</Tag>;
  };
  const filterHref = (node: string, direction: (typeof DIRECTIONS)[number]) => `${base}?${new URLSearchParams({ node, direction })}`;

  return (
    <Page>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Relationship Map"
        description="Directional relationships among this Run's repositories, resolved from the references in their Profiles."
        alerts={
          !map.coverage.complete && (
            <Alert tone="warning" title={`${countLabel(map.coverage.gaps.length, "repository", "repositories")} did not contribute`}>
              <ul>
                {map.coverage.gaps.map((gap) => (
                  <li key={gap.target}>
                    <strong>{gap.source.name}</strong>
                    {` · ${statusLabel(gap.state)}: `}
                    {failures.get(gap.target) ?? (gap.state === "canceled" ? "stopped before it finished" : "no reason was recorded")}
                    {gap.reason && (
                      <>
                        {" "}
                        <span className={styles.code}>{gap.reason}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p>Relationships these repositories declare are missing, and an unresolved reference might belong to one of them. Evaluations treat what they could contain as unknown.</p>
            </Alert>
          )
        }
      />

      <StatGroup
        label="Nodes by kind"
        stats={[
          ...NODE_KINDS.map((kind) => ({ label: KIND_PLURALS[kind], value: map.nodes.filter((node) => node.kind === kind).length })),
          { label: "Coverage gaps", value: map.coverage.gaps.length },
        ]}
      />

      <Tabs label="Relationship Map views">
        <TabLink href={base} active={view === "relationships"} count={map.edges.length}>
          Relationships
        </TabLink>
        <TabLink href={`${base}?view=nodes`} active={view === "nodes"} count={map.nodes.length}>
          Nodes
        </TabLink>
      </Tabs>

      {view === "nodes" ? (
        <Section title="Nodes" description="Everything the relationships connect. Follow a count to the relationships it stands for.">
          <Panel flush>
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
                      <Primary>{nodeLink(node.id)}</Primary>
                      {node.kind === "out_of_scope_source" && <Secondary>In the catalog but not in this Run; not analyzed</Secondary>}
                    </Td>
                    <Td label="Kind">{KIND_LABELS[node.kind]}</Td>
                    <Td label="Outgoing" align="numeric">
                      {outgoing ? (
                        <Link href={filterHref(node.id, "outgoing")} aria-label={`${outgoing} outgoing from ${label}`}>
                          {outgoing}
                        </Link>
                      ) : (
                        0
                      )}
                    </Td>
                    <Td label="Incoming" align="numeric">
                      {incoming ? (
                        <Link href={filterHref(node.id, "incoming")} aria-label={`${incoming} incoming to ${label}`}>
                          {incoming}
                        </Link>
                      ) : (
                        0
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </Section>
      ) : (
        <Section title="Relationships" description="Each row reads from the repository that declared the reference to what it refers to.">
          <FilterBar key={JSON.stringify(filters)} action={base} label="Filter relationships" filtered={filtered} clearHref={base}>
            <Select
              id="filter-node"
              name="node"
              label="Node"
              size="sm"
              defaultValue={filters.node ?? ""}
              options={[{ value: "", label: "Any node" }, ...sortedNodes.map((node) => ({ value: node.id, label: `${nodeLabel(node)} (${KIND_LABELS[node.kind].toLowerCase()})` }))]}
            />
            <Select
              id="filter-direction"
              name="direction"
              label="Direction"
              size="sm"
              defaultValue={filters.direction}
              options={[
                { value: "either", label: "Either direction" },
                { value: "outgoing", label: "Outgoing from the node" },
                { value: "incoming", label: "Incoming to the node" },
              ]}
            />
            <Select id="filter-type" name="type" label="Relationship type" size="sm" defaultValue={filters.type ?? ""} options={[{ value: "", label: "Any type" }, ...EDGE_TYPES.map((type) => ({ value: type, label: EDGE_LABELS[type][0] }))]} />
            <Select id="filter-state" name="state" label="Resolution state" size="sm" defaultValue={filters.state ?? ""} options={[{ value: "", label: "Any state" }, ...RESOLUTION_STATES.map((state) => ({ value: state, label: statusLabel(state) }))]} />
          </FilterBar>
          <p role="status" className={styles.count}>
            {filtered ? `Showing ${edges.length} of ${countLabel(map.edges.length, "relationship")}` : countLabel(map.edges.length, "relationship")}
          </p>
          <Panel flush>
            {edges.length > 0 ? (
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
                      <Secondary>{`${EDGE_LABELS[edge.type][0]}, ${edgeBasis(edge.basis).toLowerCase()}`}</Secondary>
                    </Td>
                    <Td label="To">
                      {edge.to ? (
                        nodeLink(edge.to)
                      ) : (
                        <>
                          One of:
                          <ul className={styles.candidates} aria-label="Candidates">
                            {[...edge.candidates]
                              .sort((a, b) => nodeLabel(nodes.get(a)!).localeCompare(nodeLabel(nodes.get(b)!)))
                              .map((candidate) => (
                                <li key={candidate}>{nodeLink(candidate)}</li>
                              ))}
                          </ul>
                        </>
                      )}
                    </Td>
                    <Td label="State">
                      <Status state={edge.state} />
                      {edge.reason && <Secondary>{edge.reason}</Secondary>}
                      {edge.state === "unresolved" && !map.coverage.complete && <Secondary>A repository that was not assessed might resolve it.</Secondary>}
                    </Td>
                    <Td label="Evidence">
                      <EvidenceList ids={edge.evidence} records={map.evidence} assessmentId={assessment.publicId} />
                    </Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState title={filtered ? "No matching relationships" : "No relationships"}>{filtered ? "No relationship matches these filters." : "No repository declared a relationship."}</EmptyState>
            )}
          </Panel>
        </Section>
      )}
    </Page>
  );
}
