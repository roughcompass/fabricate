import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { JsonObject } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { dependencyFacts, graphEdges, graphNodes, ontologyConcepts, ontologyReleases } from "@/lib/db/schema";
import { type DiagramEdge, type DiagramModel, type Signal, diagramModel } from "./diagram";
import { type MapView, type ViewRepository, applicationLabel, edgesByIds, edgesFrom, edgesInto, evidenceRecords, nodesOf, repositoryRelationships } from "./map-view";
import { compare } from "./placement";
import { type GroupDefinition, groupKey, lineOfBusinessGroups, portalGroups, rollUp, runLevelGroups, unassignedGroups } from "./rollup";

/*
 * The data behind each Relationship Map view (design decisions 1 to 10):
 * ownership levels with their rolled-up relationships, diagrams, declared and
 * observed membership, shared libraries and services, the focus on a
 * repository, service, or package, search, and the scoped relationships
 * table. Everything here reads the projection and current ownership; none of
 * it parses a document.
 */

export const PAGE_SIZE = 50;

export interface GroupLink {
  key: string;
  label: string;
  href: string;
}

export interface LevelGroup extends GroupLink {
  repositories: number;
  internal: number;
}

export interface LevelRelationship {
  from: GroupLink;
  to: GroupLink;
  repositoryRelationships: number;
}

export interface SharedEntry {
  nodeId: string;
  label: string;
  kind: "library" | "service";
  dependents: number;
  href: string;
}

export interface PathStep {
  label: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Addresses

export const href = {
  run: (view: MapView) => view.base,
  lineOfBusiness: (view: MapView, id: string | null) => `${view.base}/lob/${id ?? "none"}`,
  portal: (view: MapView, id: string) => `${view.base}/portal/${id}`,
  application: (view: MapView, sealId: string) => `${view.base}/seal/${encodeURIComponent(sealId)}`,
  unassigned: (view: MapView) => `${view.base}/unassigned`,
  system: (view: MapView, id: string) => `${view.base}/unassigned/${id}`,
};

/** A level's address with its focus, search, and pages. */
export function withQuery(levelHref: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "" && !(key.endsWith("page") && value === 1) && !(["dependents", "dependencies"].includes(key) && value === 1)) params.set(key, String(value));
  const search = params.toString();
  return search ? `${levelHref}?${search}` : levelHref;
}

export const focusParam = {
  node: (nodeId: string) => nodeId,
  package: (name: string) => `package:${name}`,
};

function groupHref(view: MapView, key: string): string {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  switch (kind) {
    case "lob":
      return href.lineOfBusiness(view, id === "none" ? null : id);
    case "portal":
      return href.portal(view, id);
    case "seal":
      return href.application(view, view.applications.get(id)?.sealId ?? id);
    case "system":
      return href.system(view, id);
    default:
      return href.unassigned(view);
  }
}

function link(view: MapView, group: GroupDefinition): GroupLink {
  return { key: group.key, label: group.label, href: groupHref(view, group.key) };
}

function summarize(view: MapView, groups: readonly GroupDefinition[], relationships: ReturnType<typeof repositoryRelationships>) {
  const rollup = rollUp(groups, relationships);
  const links = new Map(groups.map((group) => [group.key, link(view, group)]));
  return {
    groups: rollup.groups.map((group) => ({ ...links.get(group.key)!, repositories: group.repositories, internal: group.internal })),
    relationships: rollup.relationships
      .map((relationship) => ({ from: links.get(relationship.from)!, to: links.get(relationship.to)!, repositoryRelationships: relationship.repositoryRelationships }))
      .sort((a, b) => b.repositoryRelationships - a.repositoryRelationships || compare(a.from.label, b.from.label) || compare(a.to.label, b.to.label)),
    total: rollup.total,
  };
}

/** The repositories placed anywhere under one Line of Business. */
function lineOfBusinessMembers(view: MapView, lineOfBusiness: string | null): Set<string> {
  const members = new Set<string>();
  for (const [node, placed] of view.placements.byNode) {
    if (placed.some((placement) => placement.kind !== "unassigned" && placement.lineOfBusiness === lineOfBusiness)) members.add(node);
  }
  return members;
}

function applicationOf(view: MapView): Map<string, string> {
  return new Map([...view.repositories.values()].filter((repository) => repository.application).map((repository) => [repository.nodeId, repository.application!]));
}

// ---------------------------------------------------------------------------
// Shared libraries and services

/** The libraries built in the Run, and the services, that +members+ depend on, with their number of dependents among them. */
export function sharedAt(db: Executor, view: MapView, levelHref: string, members: ReadonlySet<string>): SharedEntry[] {
  const dependents = new Map<string, Set<string>>();
  const rows = db
    .select({ from: graphEdges.fromNode, to: graphEdges.toNode, type: graphEdges.type })
    .from(graphEdges)
    .where(and(eq(graphEdges.mapId, view.map.id), eq(graphEdges.kind, "architecture"), inArray(graphEdges.type, ["package_dependency", "service_call"]), eq(graphEdges.state, "resolved")))
    .all();
  for (const row of rows) {
    if (row.to === null || !members.has(row.from) || row.from === row.to) continue;
    dependents.set(row.to, (dependents.get(row.to) ?? new Set()).add(row.from));
  }
  const nodes = nodesOf(db, view, [...dependents.keys()]);
  return [...dependents]
    .map(([nodeId, from]) => {
      const node = nodes.get(nodeId)!;
      const kind: SharedEntry["kind"] = node.kind === "external_service" ? "service" : "library";
      return { nodeId, label: node.label, kind, dependents: from.size, href: withQuery(levelHref, { focus: nodeId }) };
    })
    .filter((entry) => entry.kind === "service" || view.repositories.has(entry.nodeId))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "library" ? -1 : 1) || b.dependents - a.dependents || compare(a.label, b.label));
}

// ---------------------------------------------------------------------------
// Levels

export interface RunLevel {
  groups: LevelGroup[];
  relationships: LevelRelationship[];
  total: number;
  shared: SharedEntry[];
}

export function runLevel(db: Executor, view: MapView): RunLevel {
  const groups = runLevelGroups(view.placements.byNode, view.labels);
  return { ...summarize(view, groups, repositoryRelationships(db, view)), shared: sharedAt(db, view, href.run(view), new Set(view.repositories.keys())) };
}

export interface LineOfBusinessLevel {
  id: string | null;
  label: string;
  portals: LevelGroup[];
  applications: LevelGroup[];
  otherPortals: LevelGroup[];
  relationships: LevelRelationship[];
  total: number;
  shared: SharedEntry[];
  members: Set<string>;
}

export function lineOfBusinessLevel(db: Executor, view: MapView, id: string | null): LineOfBusinessLevel | undefined {
  if (id !== null && !view.linesOfBusiness.has(id)) return undefined;
  const members = lineOfBusinessMembers(view, id);
  if (id === null && members.size === 0) return undefined;
  const { portals, applications, otherPortals } = lineOfBusinessGroups(view.placements.byNode, id, applicationOf(view), view.labels);
  const relationships = repositoryRelationships(db, view);
  const summary = summarize(view, [...portals, ...applications, ...otherPortals], relationships);
  const byKey = new Map(summary.groups.map((group) => [group.key, group]));
  return {
    id,
    label: view.labels.lineOfBusiness(id),
    portals: portals.map((group) => byKey.get(group.key)!),
    applications: applications.map((group) => byKey.get(group.key)!),
    otherPortals: otherPortals.map((group) => byKey.get(group.key)!),
    relationships: summary.relationships,
    total: members.size,
    shared: sharedAt(db, view, href.lineOfBusiness(view, id), members),
    members,
  };
}

export interface DiagramBox {
  nodeId: string;
  label: string;
  /** A second line: the SEAL application, or what kind of node it is. */
  detail: string | null;
  marks: string[];
  href: string;
  row: number;
}

export interface DiagramData {
  rows: DiagramBox[][];
  model: DiagramModel;
  /** The third-party packages the drawing leaves out, each opening its package focus. */
  thirdParty: { name: string; href: string }[];
}

export interface PortalLevel {
  id: string;
  label: string;
  lineOfBusiness: PathStep;
  ownerLabel: string | null;
  hostName: string | null;
  groups: LevelGroup[];
  diagram: DiagramData;
  membership: Membership;
  shared: SharedEntry[];
  members: Set<string>;
}

export interface Membership {
  /** False when the portal has no claimed host in this Run, so loading can't be compared with claims. */
  comparable: boolean;
  claimedNotLoaded: GroupLink[];
  loadedNotClaimed: { nodeId: string; label: string; href: string }[];
}

export function portalLevel(db: Executor, view: MapView, id: string): PortalLevel | undefined {
  const portal = view.portals.get(id);
  if (!portal) return undefined;
  const levelHref = href.portal(view, id);
  const applications = applicationOf(view);
  const groups = portalGroups(view.placements.byNode, id, applications, view.labels);
  const members = new Set(groups.flatMap((group) => [...group.members]));
  if (portal.host) members.add(portal.host);

  const fromMembers = edgesFrom(db, view, [...members]);
  const loaded = new Set(fromMembers.filter((edge) => edge.from === portal.host && edge.state === "resolved" && edge.to && (edge.type === "composition" || edge.type === "iframe") && view.repositories.has(edge.to)).map((edge) => edge.to!));
  const claimed = new Set([...members].filter((node) => node !== portal.host));
  const libraries = new Set(fromMembers.filter((edge) => edge.kind === "architecture" && edge.state === "resolved" && edge.type === "package_dependency" && edge.to && view.repositories.has(edge.to) && !members.has(edge.to) && !loaded.has(edge.to)).map((edge) => edge.to!));
  // Libraries sit directly under the applications that use them, so no arrow crosses a row; the
  // claimed applications the host doesn't load come last.
  const rows: string[][] = [portal.host ? [portal.host] : [], [...loaded], [...libraries], [...claimed].filter((node) => !loaded.has(node))];

  const edges = [...fromMembers, ...edgesFrom(db, view, [...loaded].filter((node) => !members.has(node)))];
  const diagram = diagramFor(db, view, levelHref, rows, edges, (node) => groupKeyOf(view, node), (node) => (node === portal.host ? ["Host"] : marksIn(view, node, id, loaded)));

  const summary = summarize(view, groups, repositoryRelationships(db, view));
  const membership: Membership = portal.host
    ? {
        comparable: true,
        claimedNotLoaded: groups
          .filter((group) => ![...group.members].some((node) => loaded.has(node) || node === portal.host))
          .map((group) => link(view, group)),
        loadedNotClaimed: [...loaded]
          .filter((node) => !claimed.has(node))
          .map((node) => ({ nodeId: node, label: view.repositories.get(node)!.label, href: withQuery(levelHref, { focus: node }) }))
          .sort((a, b) => compare(a.label, b.label)),
      }
    : { comparable: false, claimedNotLoaded: [], loadedNotClaimed: [] };

  return {
    id,
    label: portal.label,
    lineOfBusiness: { label: view.labels.lineOfBusiness(portal.lineOfBusiness), href: href.lineOfBusiness(view, portal.lineOfBusiness) },
    ownerLabel: applicationLabel(portal.owner ?? undefined) ?? null,
    hostName: portal.hostName,
    groups: summary.groups,
    diagram,
    membership,
    shared: sharedAt(db, view, levelHref, members),
    members,
  };
}

export interface ApplicationLevel {
  id: string;
  sealId: string;
  label: string;
  lineOfBusiness: PathStep;
  portals: GroupLink[];
  diagram: DiagramData;
  shared: SharedEntry[];
  members: Set<string>;
}

export function applicationLevel(db: Executor, view: MapView, sealId: string): ApplicationLevel | undefined {
  const application = [...view.applications.values()].find((item) => item.sealId === sealId);
  if (!application) return undefined;
  const levelHref = href.application(view, sealId);
  const members = new Set([...view.repositories.values()].filter((repository) => repository.application === application.id).map((repository) => repository.nodeId));
  const diagram = neighbourhoodDiagram(db, view, levelHref, members);
  const portals = [...new Set([...members].flatMap((node) => view.repositories.get(node)!.portals))]
    .map((portal) => ({ key: groupKey.portal(portal), label: view.labels.portal(portal), href: href.portal(view, portal) }))
    .sort((a, b) => compare(a.label, b.label));
  return {
    id: application.id,
    sealId,
    label: view.labels.application(application.id),
    lineOfBusiness: { label: view.labels.lineOfBusiness(application.lineOfBusiness), href: href.lineOfBusiness(view, application.lineOfBusiness) },
    portals,
    diagram,
    shared: sharedAt(db, view, levelHref, members),
    members,
  };
}

export interface UnassignedLevel {
  systems: LevelGroup[];
  relationships: LevelRelationship[];
  total: number;
  shared: SharedEntry[];
  members: Set<string>;
}

export function unassignedLevel(db: Executor, view: MapView): UnassignedLevel {
  const groups = unassignedGroups(view.placements.byNode, view.labels);
  const members = new Set(groups.flatMap((group) => [...group.members]));
  const summary = summarize(view, groups, repositoryRelationships(db, view));
  return { systems: summary.groups, relationships: summary.relationships, total: summary.total, shared: sharedAt(db, view, href.unassigned(view), members), members };
}

export interface SystemLevel {
  id: string;
  label: string;
  diagram: DiagramData;
  shared: SharedEntry[];
  members: Set<string>;
}

export function systemLevel(db: Executor, view: MapView, id: string): SystemLevel | undefined {
  const system = view.placements.systems.find((item) => item.id === id);
  if (!system) return undefined;
  const levelHref = href.system(view, id);
  const members = new Set(system.members);
  return { id, label: system.name, diagram: neighbourhoodDiagram(db, view, levelHref, members), shared: sharedAt(db, view, levelHref, members), members };
}

/**
 * A diagram of +members+ with what depends on them above and what they depend
 * on below: libraries built in the Run, then services. Each repository is its
 * own group, so every relationship between two of them is drawn.
 */
function neighbourhoodDiagram(db: Executor, view: MapView, levelHref: string, members: ReadonlySet<string>): DiagramData {
  const outgoing = edgesFrom(db, view, [...members]);
  const incoming = edgesInto(db, view, [...members]).filter((edge) => !members.has(edge.from) && edge.kind === "architecture" && edge.state === "resolved");
  const above = [...new Set(incoming.map((edge) => edge.from))];
  const below = outgoing.filter((edge) => edge.kind === "architecture" && edge.state === "resolved" && edge.to && !members.has(edge.to));
  const libraries = [...new Set(below.filter((edge) => view.repositories.has(edge.to!)).map((edge) => edge.to!))].filter((node) => !above.includes(node));
  const services = [...new Set(below.filter((edge) => !view.repositories.has(edge.to!)).map((edge) => edge.to!))];
  const rows = [above, [...members], [...libraries, ...services]];
  return diagramFor(db, view, levelHref, rows, [...outgoing, ...incoming], (node) => (view.repositories.has(node) ? groupKey.repository(node) : `node:${node}`), (node) => marksOf(view, node));
}

function diagramFor(db: Executor, view: MapView, levelHref: string, nodeRows: readonly string[][], edges: readonly DiagramEdge[], groupOf: (node: string) => string, marks: (node: string) => string[]): DiagramData {
  const all = nodeRows.flat();
  const others = nodesOf(db, view, [...all.filter((node) => !view.repositories.has(node)), ...edges.flatMap((edge) => [edge.to, ...edge.candidates]).filter((node): node is string => node !== null && !view.repositories.has(node))]);
  const labelOf = (node: string) => view.repositories.get(node)?.label ?? others.get(node)?.label ?? node;
  const rows = nodeRows.map((row, index) =>
    [...new Set(row)].map((nodeId) => {
      const repository = view.repositories.get(nodeId);
      const detail = repository ? (repository.application ? view.labels.application(repository.application) : "Unassigned") : others.get(nodeId)?.kind === "external_service" ? "Service" : null;
      return { nodeId, label: labelOf(nodeId), detail, marks: marks(nodeId), href: withQuery(levelHref, { focus: nodeId }), row: index };
    }),
  );
  const groups = new Map(rows.flat().map((box) => [box.nodeId, groupOf(box.nodeId)]));
  const model = diagramModel(groups, edges, labelOf);
  return { rows, model, thirdParty: model.thirdPartyPackages.map((name) => ({ name, href: withQuery(levelHref, { focus: focusParam.package(name) }) })) };
}

function groupKeyOf(view: MapView, node: string): string {
  const application = view.repositories.get(node)?.application;
  return application ? groupKey.application(application) : groupKey.repository(node);
}

/** A repository's marks inside one portal: other portals, another Line of Business, or not claimed here. */
function marksIn(view: MapView, node: string, portal: string, loaded: ReadonlySet<string>): string[] {
  const repository = view.repositories.get(node);
  if (!repository) return [];
  const placement = view.placements.byNode.get(node)?.find((item) => item.kind === "portal" && item.portal === portal);
  if (!placement || placement.kind !== "portal") return loaded.has(node) ? ["Not claimed here"] : [];
  const marks = placement.alsoIn.map((other) => `Also in ${view.labels.portal(other)}`);
  if (placement.ownLineOfBusiness !== null) marks.push(`${view.labels.lineOfBusiness(placement.ownLineOfBusiness)} Line of Business`);
  return marks;
}

function marksOf(view: MapView, node: string): string[] {
  const repository = view.repositories.get(node);
  if (!repository) return [];
  return repository.portals.map((portal) => view.labels.portal(portal));
}

// ---------------------------------------------------------------------------
// Focus

export interface FocusRow {
  nodeId: string | null;
  label: string;
  href: string | null;
  state: string;
  reason: string | null;
  signals: Signal[];
}

export interface FocusGroup {
  label: string;
  rows: FocusRow[];
}

export interface FocusList {
  groups: FocusGroup[];
  total: number;
  page: number;
  pages: number;
}

export interface Focus {
  kind: "repository" | "service" | "package" | "node";
  nodeId: string | null;
  label: string;
  sentence: string;
  profileHref: string | null;
  dependents: FocusList;
  dependencies: FocusList;
  thirdParty: { name: string; href: string }[];
  producer: { label: string; href: string } | null;
  /** For a package: each dependent with its declared range. */
  declarations: { label: string; href: string; group: string; manifest: string; specifier: string | null; resolvedVersion: string | null }[];
  evidence: JsonObject;
}

export interface FocusPages {
  dependents?: number;
  dependencies?: number;
}

export function focusOf(db: Executor, view: MapView, levelHref: string, focus: string, pages: FocusPages = {}): Focus | undefined {
  if (focus.startsWith("package:")) return packageFocus(db, view, levelHref, focus.slice("package:".length));
  const node = nodesOf(db, view, [focus]).get(focus);
  if (!node) return undefined;
  const repository = view.repositories.get(focus);
  const kind: Focus["kind"] = repository ? "repository" : node.kind === "external_service" ? "service" : node.kind === "package" ? "package" : "node";
  if (kind === "package") return packageFocus(db, view, levelHref, node.label);

  const incoming = edgesInto(db, view, [focus]).filter((edge) => edge.kind === "architecture" && edge.from !== focus);
  const outgoing = edgesFrom(db, view, [focus]).filter((edge) => edge.kind !== "own_package" && edge.kind !== "self");
  const contractsOut = outgoing.filter((edge) => edge.type === "runtime_contract" && edge.to !== null);
  const contractsIn = incoming.filter((edge) => edge.type === "runtime_contract");

  // Dependents: who reaches the focus, plus whom it exchanges runtime contracts with.
  const dependentEdges = [...incoming.filter((edge) => edge.state === "resolved"), ...contractsOut.map((edge) => ({ ...edge, from: edge.to!, to: edge.from }))];
  // Dependencies: what the focus reaches, plus who exchanges runtime contracts with it.
  const dependencyEdges = [...outgoing.filter((edge) => edge.kind === "architecture"), ...contractsIn.map((edge) => ({ ...edge, from: edge.to!, to: edge.from }))];
  const thirdParty = [...new Set(outgoing.filter((edge) => edge.kind === "third_party").map((edge) => edge.referenceIdentifier.name ?? Object.values(edge.referenceIdentifier).join(" ")))].sort(compare);

  const labels = nodesOf(db, view, [...dependencyEdges.map((edge) => edge.to), ...dependencyEdges.flatMap((edge) => edge.candidates)].filter((id): id is string => id !== null));
  const labelOf = (id: string) => view.repositories.get(id)?.label ?? labels.get(id)?.label ?? id;
  const dependents = focusList(view, levelHref, mergeBy(dependentEdges, (edge) => edge.from), labelOf, pages.dependents);
  const dependencies = focusList(view, levelHref, mergeBy(dependencyEdges, (edge) => edge.to ?? `unmatched:${edge.edgeId}`), labelOf, pages.dependencies);

  const direct = new Set(dependentEdges.map((edge) => edge.from));
  const portals = new Set([...direct].flatMap((id) => view.repositories.get(id)?.portals ?? []));
  const further = repository || kind === "service" ? furtherDependents(db, view, focus, direct) : 0;
  const evidenceIds = [...dependents.groups, ...dependencies.groups].flatMap((group) => group.rows.flatMap((row) => row.signals.flatMap((signal) => signal.evidence)));
  return {
    kind,
    nodeId: focus,
    label: node.label,
    sentence: impactSentence(node.label, direct.size, portals.size, further),
    profileHref: repository?.profile ? `/profiles/${repository.profile}` : null,
    dependents,
    dependencies,
    thirdParty: thirdParty.map((name) => ({ name, href: withQuery(levelHref, { focus: focusParam.package(name) }) })),
    producer: null,
    declarations: [],
    evidence: evidenceRecords(db, view.assessment.id, evidenceIds),
  };
}

/** "Changing design-tokens directly affects 162 repositories in 4 portals; 40 more depend on it through them." */
export function impactSentence(label: string, direct: number, portals: number, further: number): string {
  if (direct === 0) return `Nothing in this Run depends on ${label}.`;
  const repositories = `${direct.toLocaleString("en-US")} ${direct === 1 ? "repository" : "repositories"}`;
  const where = portals > 0 ? ` in ${portals.toLocaleString("en-US")} ${portals === 1 ? "portal" : "portals"}` : "";
  const through = further > 0 ? `; ${further.toLocaleString("en-US")} more ${further === 1 ? "depends" : "depend"} on it through them` : "";
  return `Changing ${label} directly affects ${repositories}${where}${through}.`;
}

/** Repositories that depend on the focus only through its direct dependents, by a recursive query over reversed relationships. */
export function furtherDependents(db: Executor, view: MapView, focus: string, direct: ReadonlySet<string>): number {
  const reached = db.all<{ node: string }>(sql`
    WITH RECURSIVE reach(node) AS (
      SELECT ${graphEdges.fromNode} FROM ${graphEdges}
      WHERE ${graphEdges.mapId} = ${view.map.id} AND ${graphEdges.toNode} = ${focus} AND ${graphEdges.state} = 'resolved' AND ${graphEdges.kind} = 'architecture'
      UNION
      SELECT edge.from_node FROM graph_edges AS edge JOIN reach ON edge.to_node = reach.node
      WHERE edge.map_id = ${view.map.id} AND edge.state = 'resolved' AND edge.kind = 'architecture'
    )
    SELECT node FROM reach`);
  return reached.filter((row) => row.node !== focus && !direct.has(row.node) && view.repositories.has(row.node)).length;
}

interface MergedRow {
  nodeId: string | null;
  key: string;
  edges: DiagramEdge[];
}

function mergeBy(edges: readonly DiagramEdge[], key: (edge: DiagramEdge) => string): MergedRow[] {
  const rows = new Map<string, MergedRow>();
  for (const edge of edges) {
    const id = key(edge);
    const row = rows.get(id) ?? { nodeId: id.startsWith("unmatched:") ? null : id, key: id, edges: [] };
    row.edges.push(edge);
    rows.set(id, row);
  }
  return [...rows.values()];
}

function focusList(view: MapView, levelHref: string, merged: readonly MergedRow[], labelOf: (id: string) => string, page = 1): FocusList {
  const rows = merged.map((row) => {
    const edge = row.edges[0]!;
    const label = row.nodeId ? labelOf(row.nodeId) : edge.state === "ambiguous" ? `One of ${edge.candidates.map(labelOf).join(", ")}` : Object.values(edge.referenceIdentifier).join(" ") || edge.type;
    return {
      group: row.nodeId ? groupLabelOf(view, row.nodeId) : "Unmatched references",
      row: {
        nodeId: row.nodeId,
        label,
        href: row.nodeId ? withQuery(levelHref, { focus: row.nodeId }) : null,
        state: row.edges.some((item) => item.state === "resolved") ? "resolved" : edge.state,
        reason: edge.reason ?? null,
        signals: row.edges.map((item) => ({ edgeId: item.edgeId, type: item.type, rule: item.rule, basis: item.basis, evidence: item.evidence })).sort((a, b) => compare(a.type, b.type) || compare(a.rule, b.rule)),
      },
    };
  });
  rows.sort((a, b) => (a.group === "Unmatched references" ? 1 : 0) - (b.group === "Unmatched references" ? 1 : 0) || compare(a.group, b.group) || compare(a.row.label, b.row.label));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const groups: FocusGroup[] = [];
  for (const item of rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)) {
    const last = groups.at(-1);
    if (last && last.label === item.group) last.rows.push(item.row);
    else groups.push({ label: item.group, rows: [item.row] });
  }
  return { groups, total: rows.length, page: current, pages };
}

/** "FX Board (SEAL-1001) · Access, Markets", "Unassigned", or "Services". */
function groupLabelOf(view: MapView, nodeId: string): string {
  const repository = view.repositories.get(nodeId);
  if (!repository) return "Services and packages";
  if (!repository.application) return "Unassigned";
  const portals = repository.portals.map((portal) => view.labels.portal(portal)).sort(compare);
  return [view.labels.application(repository.application), ...(portals.length > 0 ? [portals.join(", ")] : [])].join(" · ");
}

function packageFocus(db: Executor, view: MapView, levelHref: string, name: string): Focus | undefined {
  const declared = db
    .select({ targetId: dependencyFacts.assessmentTargetId, manifest: dependencyFacts.manifest, specifier: dependencyFacts.specifier, resolvedVersion: dependencyFacts.resolvedVersion })
    .from(dependencyFacts)
    .where(and(eq(dependencyFacts.assessmentId, view.assessment.id), eq(dependencyFacts.packageName, name)))
    .all();
  const producers = db
    .select({ from: graphEdges.fromNode, identifier: graphEdges.referenceIdentifier })
    .from(graphEdges)
    .where(and(eq(graphEdges.mapId, view.map.id), eq(graphEdges.kind, "own_package"), eq(graphEdges.type, "package_production")))
    .all()
    .filter((edge) => (JSON.parse(edge.identifier ?? "{}") as Record<string, string>).name === name);
  if (declared.length === 0 && producers.length === 0) return undefined;

  const nodeOfTarget = new Map(
    db
      .select({ targetId: graphNodes.assessmentTargetId, nodeId: graphNodes.nodeId })
      .from(graphNodes)
      .where(and(eq(graphNodes.mapId, view.map.id), eq(graphNodes.kind, "repository")))
      .all()
      .map((row) => [row.targetId!, row.nodeId]),
  );
  const declarations = declared
    .flatMap((row) => {
      const nodeId = nodeOfTarget.get(row.targetId);
      const repository = nodeId ? view.repositories.get(nodeId) : undefined;
      return repository ? [{ label: repository.label, href: withQuery(levelHref, { focus: repository.nodeId }), group: groupLabelOf(view, repository.nodeId), manifest: row.manifest, specifier: row.specifier, resolvedVersion: row.resolvedVersion }] : [];
    })
    .sort((a, b) => compare(a.group, b.group) || compare(a.label, b.label) || compare(a.manifest, b.manifest));
  const producer = producers.map((edge) => view.repositories.get(edge.from)).find((repository): repository is ViewRepository => repository !== undefined);
  const dependents = new Set(declarations.map((row) => row.label)).size;
  const portals = new Set(declared.flatMap((row) => view.repositories.get(nodeOfTarget.get(row.targetId) ?? "")?.portals ?? []));
  const empty: FocusList = { groups: [], total: 0, page: 1, pages: 1 };
  return {
    kind: "package",
    nodeId: null,
    label: name,
    sentence: producer
      ? `${name} is built in this Run by ${producer.label}. ${dependents.toLocaleString("en-US")} ${dependents === 1 ? "repository declares" : "repositories declare"} it${portals.size > 0 ? ` in ${portals.size.toLocaleString("en-US")} ${portals.size === 1 ? "portal" : "portals"}` : ""}.`
      : `${name} is third-party: no repository in this Run produces it. ${dependents.toLocaleString("en-US")} ${dependents === 1 ? "repository declares" : "repositories declare"} it${portals.size > 0 ? ` in ${portals.size.toLocaleString("en-US")} ${portals.size === 1 ? "portal" : "portals"}` : ""}.`,
    profileHref: null,
    dependents: empty,
    dependencies: empty,
    thirdParty: [],
    producer: producer ? { label: producer.label, href: withQuery(levelHref, { focus: producer.nodeId }) } : null,
    declarations,
    evidence: {} as JsonObject,
  };
}

// ---------------------------------------------------------------------------
// Search

export interface SearchMatch {
  kind: "repository" | "application" | "portal" | "service" | "package";
  label: string;
  detail: string | null;
  href: string;
  rank: number;
}

export const SEARCH_KINDS = ["repository", "application", "portal", "service", "package"] as const;
const PER_KIND = 10;

/** Matches for +query+ by kind, exact before prefix before substring, up to ten of each. */
export function searchMap(db: Executor, view: MapView, query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const rank = (...values: (string | null | undefined)[]) => {
    let best = Number.POSITIVE_INFINITY;
    for (const value of values) {
      const text = value?.toLowerCase();
      if (!text) continue;
      best = Math.min(best, text === needle ? 0 : text.startsWith(needle) ? 1 : text.includes(needle) ? 2 : Number.POSITIVE_INFINITY);
    }
    return best;
  };
  const matches: SearchMatch[] = [];
  const add = (match: Omit<SearchMatch, "rank">, value: number) => {
    if (Number.isFinite(value)) matches.push({ ...match, rank: value });
  };

  for (const repository of view.repositories.values()) add({ kind: "repository", label: repository.label, detail: repository.application ? view.labels.application(repository.application) : "Unassigned", href: withQuery(primaryLevelOf(view, repository), { focus: repository.nodeId }) }, rank(repository.label));
  for (const application of view.applications.values()) add({ kind: "application", label: application.sealId, detail: application.name, href: href.application(view, application.sealId) }, rank(application.sealId, application.name));
  const aliases = portalAliases(db, view);
  for (const portal of view.portals.values()) add({ kind: "portal", label: portal.label, detail: portal.owner ? `Owned by ${applicationLabel(portal.owner)}` : null, href: href.portal(view, portal.id) }, rank(portal.label, ...(aliases.get(portal.id) ?? [])));
  for (const service of db.select({ nodeId: graphNodes.nodeId, label: graphNodes.label }).from(graphNodes).where(and(eq(graphNodes.mapId, view.map.id), eq(graphNodes.kind, "external_service"))).all()) {
    add({ kind: "service", label: service.label, detail: null, href: withQuery(view.base, { focus: service.nodeId }) }, rank(service.label));
  }
  for (const pkg of db
    .select({ name: dependencyFacts.packageName, dependents: count() })
    .from(dependencyFacts)
    .where(and(eq(dependencyFacts.assessmentId, view.assessment.id), sql`instr(lower(${dependencyFacts.packageName}), ${needle}) > 0`))
    .groupBy(dependencyFacts.packageName)
    .orderBy(asc(dependencyFacts.packageName))
    .all()) {
    add({ kind: "package", label: pkg.name, detail: `${pkg.dependents.toLocaleString("en-US")} ${pkg.dependents === 1 ? "declaration" : "declarations"}`, href: withQuery(view.base, { focus: focusParam.package(pkg.name) }) }, rank(pkg.name));
  }

  return SEARCH_KINDS.flatMap((kind) =>
    matches
      .filter((match) => match.kind === kind)
      .sort((a, b) => a.rank - b.rank || compare(a.label.toLowerCase(), b.label.toLowerCase()) || compare(a.href, b.href))
      .slice(0, PER_KIND),
  );
}

/** The level a search result for a repository opens: its first portal, its Line of Business, or its runtime system. */
function primaryLevelOf(view: MapView, repository: ViewRepository): string {
  const placed = view.placements.byNode.get(repository.nodeId) ?? [];
  const portal = placed.find((placement) => placement.kind === "portal");
  if (portal && portal.kind === "portal") return href.portal(view, portal.portal);
  const lineOfBusiness = placed.find((placement) => placement.kind === "line_of_business");
  if (lineOfBusiness && lineOfBusiness.kind === "line_of_business") return href.lineOfBusiness(view, lineOfBusiness.lineOfBusiness);
  const system = placed.find((placement) => placement.kind === "unassigned");
  return system && system.kind === "unassigned" ? href.system(view, system.system) : href.run(view);
}

/** The aliases of each portal whose concept the newest ontology release defines. */
function portalAliases(db: Executor, view: MapView): Map<string, string[]> {
  const keyed = [...view.portals.values()].map((portal) => ({ portal, conceptKey: portal.conceptKey })).filter((item) => item.conceptKey !== null);
  if (keyed.length === 0) return new Map();
  const release = db.select({ id: ontologyReleases.id }).from(ontologyReleases).orderBy(sql`${ontologyReleases.number} desc`).limit(1).get();
  if (!release) return new Map();
  const concepts = new Map(
    db
      .select({ key: ontologyConcepts.conceptKey, document: ontologyConcepts.document })
      .from(ontologyConcepts)
      .where(and(eq(ontologyConcepts.releaseId, release.id), inArray(ontologyConcepts.conceptKey, keyed.map((item) => item.conceptKey!))))
      .all()
      .map((row) => [row.key, (JSON.parse(row.document) as { aliases?: unknown }).aliases]),
  );
  return new Map(keyed.map((item) => [item.portal.id, (Array.isArray(concepts.get(item.conceptKey!)) ? (concepts.get(item.conceptKey!) as unknown[]) : []).filter((alias): alias is string => typeof alias === "string")]));
}

// ---------------------------------------------------------------------------
// The relationships table

export interface RelationshipRow {
  edgeId: string;
  type: string;
  state: string;
  basis: string;
  reason: string | null;
  from: { nodeId: string; label: string; kind: string };
  to: { nodeId: string; label: string; kind: string } | null;
  candidates: { nodeId: string; label: string }[];
  evidence: string[];
}

export interface RelationshipPage {
  rows: RelationshipRow[];
  total: number;
  page: number;
  pages: number;
  evidence: JsonObject;
}

export type RelationshipScope = { kind: "from"; nodes: ReadonlySet<string> } | { kind: "touching"; node: string } | { kind: "package"; name: string };

/** One page of the relationships in scope, in reading order: by declaring repository, type, then what it refers to. */
export function relationshipPage(db: Executor, view: MapView, scope: RelationshipScope, page = 1): RelationshipPage {
  const edgeIds = scopedEdgeIds(db, view, scope);
  const total = edgeIds.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  if (total === 0) return { rows: [], total, page: current, pages, evidence: {} as JsonObject };

  const ordered = db.all<{ edge_id: string }>(sql`
    SELECT edge.edge_id FROM graph_edges AS edge
    JOIN graph_nodes AS origin ON origin.map_id = edge.map_id AND origin.node_id = edge.from_node
    LEFT JOIN graph_nodes AS target ON target.map_id = edge.map_id AND target.node_id = edge.to_node
    WHERE edge.map_id = ${view.map.id} AND edge.edge_id IN (SELECT value FROM json_each(${JSON.stringify(edgeIds)}))
    ORDER BY origin.label, edge.type, coalesce(target.label, ''), edge.edge_id
    LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}`);
  const edges = new Map(edgesByIds(db, view, ordered.map((row) => row.edge_id)).map((edge) => [edge.edgeId, edge]));
  const nodes = nodesOf(db, view, [...edges.values()].flatMap((edge) => [edge.from, edge.to, ...edge.candidates]).filter((id): id is string => id !== null));
  const node = (id: string) => nodes.get(id) ?? { nodeId: id, kind: "repository", label: id };
  const rows = ordered.map(({ edge_id: id }) => {
    const edge = edges.get(id)!;
    return {
      edgeId: id,
      type: edge.type,
      state: edge.state,
      basis: edge.basis,
      reason: edge.reason ?? null,
      from: node(edge.from),
      to: edge.to ? node(edge.to) : null,
      candidates: edge.candidates.map((candidate) => ({ nodeId: candidate, label: node(candidate).label })).sort((a, b) => compare(a.label, b.label)),
      evidence: [...edge.evidence],
    };
  });
  return { rows, total, page: current, pages, evidence: evidenceRecords(db, view.assessment.id, rows.flatMap((row) => row.evidence)) };
}

function scopedEdgeIds(db: Executor, view: MapView, scope: RelationshipScope): string[] {
  if (scope.kind === "from") {
    if (scope.nodes.size === view.repositories.size) return db.select({ id: graphEdges.edgeId }).from(graphEdges).where(eq(graphEdges.mapId, view.map.id)).all().map((row) => row.id);
    return edgesFrom(db, view, [...scope.nodes]).map((edge) => edge.edgeId);
  }
  if (scope.kind === "touching") return [...new Set([...edgesFrom(db, view, [scope.node]), ...edgesInto(db, view, [scope.node])].map((edge) => edge.edgeId))];
  return db
    .select({ id: graphEdges.edgeId, identifier: graphEdges.referenceIdentifier })
    .from(graphEdges)
    .where(and(eq(graphEdges.mapId, view.map.id), inArray(graphEdges.type, ["package_dependency", "package_production"])))
    .all()
    .filter((row) => (JSON.parse(row.identifier ?? "{}") as Record<string, string>).name === scope.name)
    .map((row) => row.id);
}

