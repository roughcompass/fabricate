/*
 * Where each repository of a Run appears when the map is grouped by current
 * ownership (design decision 4). Pure: the caller supplies ownership and the
 * runtime links between repositories, so the rules are tested directly.
 *
 * - A repository appears under every portal of its SEAL application, marked
 *   with the other portals it's also in. A portal's host appears under it too,
 *   and so isn't listed as in no portal.
 * - When a portal's owner aligns to another Line of Business, the repository
 *   is marked with its own Line of Business there, and its own Line of
 *   Business also lists it under "portals of other Lines of Business".
 * - A claimed repository in no portal appears under its Line of Business.
 * - An unclaimed repository appears under Unassigned, in the runtime system
 *   that composition, iframe, and runtime-contract links tie it to.
 */

export interface PlacementRepository {
  nodeId: string;
  label: string;
  /** The effective SEAL application's public ID, or null when the repository has no claim. */
  application: string | null;
  /** The application's Line of Business, or null when none is recorded. */
  lineOfBusiness: string | null;
  /** The application's effective portals. */
  portals: readonly string[];
}

export interface PlacementPortal {
  id: string;
  /** The owner's Line of Business, or null when the portal has no owner or its owner has none. */
  lineOfBusiness: string | null;
  /** The node ID of the portal's effective host repository. */
  host: string | null;
}

/** A link that ties two repositories into one runtime system: composition, iframe, or a runtime contract. */
export interface RuntimeLink {
  from: string;
  to: string;
  type: "composition" | "iframe" | "runtime_contract";
}

export type Placement =
  | { kind: "portal"; portal: string; lineOfBusiness: string | null; alsoIn: string[]; ownLineOfBusiness: string | null; host: boolean }
  | { kind: "other_portal"; portal: string; lineOfBusiness: string | null }
  | { kind: "line_of_business"; lineOfBusiness: string | null }
  | { kind: "unassigned"; system: string };

export interface RuntimeSystem {
  /** The node ID of the repository the system is named for. */
  id: string;
  name: string;
  /** The repository with outgoing composition links, if there is one. */
  host: string | null;
  members: string[];
}

export interface Placements {
  byNode: Map<string, Placement[]>;
  systems: RuntimeSystem[];
}

export function placeRepositories(repositories: readonly PlacementRepository[], portals: readonly PlacementPortal[], links: readonly RuntimeLink[]): Placements {
  const portalById = new Map(portals.map((portal) => [portal.id, portal]));
  const byNode = new Map<string, Placement[]>();
  const unassigned: PlacementRepository[] = [];

  for (const repository of [...repositories].sort(byLabel)) {
    if (repository.application === null) {
      unassigned.push(repository);
      continue;
    }
    const placed: Placement[] = [];
    const memberOf = [...new Set(repository.portals)].sort(compare);
    for (const portalId of memberOf) {
      const lineOfBusiness = portalById.get(portalId)?.lineOfBusiness ?? null;
      const foreign = lineOfBusiness !== repository.lineOfBusiness;
      placed.push({
        kind: "portal",
        portal: portalId,
        lineOfBusiness,
        alsoIn: memberOf.filter((other) => other !== portalId),
        ownLineOfBusiness: foreign ? repository.lineOfBusiness : null,
        host: portalById.get(portalId)?.host === repository.nodeId,
      });
      if (foreign) placed.push({ kind: "other_portal", portal: portalId, lineOfBusiness: repository.lineOfBusiness });
    }
    const hosts = portals.some((portal) => portal.host === repository.nodeId);
    if (memberOf.length === 0 && !hosts) placed.push({ kind: "line_of_business", lineOfBusiness: repository.lineOfBusiness });
    byNode.set(repository.nodeId, placed);
  }

  // A host appears under the portal it hosts even when its application isn't claimed in it.
  for (const portal of [...portals].sort((a, b) => compare(a.id, b.id))) {
    if (portal.host === null) continue;
    const placed = byNode.get(portal.host);
    if (!placed || placed.some((item) => item.kind === "portal" && item.portal === portal.id)) continue;
    const repository = repositories.find((item) => item.nodeId === portal.host)!;
    const foreign = portal.lineOfBusiness !== repository.lineOfBusiness;
    placed.push({ kind: "portal", portal: portal.id, lineOfBusiness: portal.lineOfBusiness, alsoIn: [], ownLineOfBusiness: foreign ? repository.lineOfBusiness : null, host: true });
    if (foreign) placed.push({ kind: "other_portal", portal: portal.id, lineOfBusiness: repository.lineOfBusiness });
  }

  const systems = runtimeSystems(unassigned, links);
  for (const system of systems) for (const member of system.members) byNode.set(member, [{ kind: "unassigned", system: system.id }]);
  return { byNode, systems };
}

/** Unassigned repositories joined by their runtime links, by union-find. */
function runtimeSystems(repositories: readonly PlacementRepository[], links: readonly RuntimeLink[]): RuntimeSystem[] {
  const members = new Set(repositories.map((repository) => repository.nodeId));
  const parent = new Map([...members].map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const composers = new Set<string>();
  for (const link of links) {
    if (!members.has(link.from) || !members.has(link.to) || link.from === link.to) continue;
    if (link.type === "composition") composers.add(link.from);
    const [a, b] = [find(link.from), find(link.to)];
    if (a !== b) parent.set(a, b);
  }

  const labels = new Map(repositories.map((repository) => [repository.nodeId, repository.label]));
  const groups = new Map<string, string[]>();
  for (const id of members) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()]
    .map((group) => {
      const sorted = group.sort((a, b) => compare(labels.get(a)!, labels.get(b)!) || compare(a, b));
      const host = sorted.find((id) => composers.has(id)) ?? null;
      const named = host ?? sorted[0]!;
      return { id: named, name: labels.get(named)!, host, members: sorted };
    })
    .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
}

const byLabel = (a: PlacementRepository, b: PlacementRepository) => compare(a.label, b.label) || compare(a.nodeId, b.nodeId);

/** Code-unit order, so the same input always sorts the same way, whatever the locale. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
