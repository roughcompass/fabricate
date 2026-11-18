import { type Placement, compare } from "./placement";

/*
 * Rolling repository relationships up into relationships between groups
 * (design decisions 3 and 5). A level's groups are sets of repositories; a
 * repository can sit in several. Each relationship between two repositories
 * contributes to every pair of their groups: inside one group it folds into
 * that group's internal count, and between two groups it counts toward their
 * relationship. Counts are distinct repository pairs, so two rules that link
 * the same two repositories count once.
 */

export interface GroupDefinition {
  key: string;
  label: string;
  members: ReadonlySet<string>;
}

/** A resolved architecture relationship between two repositories. */
export interface RepositoryRelationship {
  edgeId: string;
  from: string;
  to: string;
}

interface GroupSummary {
  key: string;
  label: string;
  repositories: number;
  /** Distinct repository relationships whose endpoints are both in this group. */
  internal: number;
}

interface GroupRelationship {
  from: string;
  to: string;
  /** Distinct repository relationships this one represents. */
  repositoryRelationships: number;
  edgeIds: string[];
}

export interface Rollup {
  groups: GroupSummary[];
  relationships: GroupRelationship[];
  /** Repositories at this level, each counted once however many of its groups it's in. */
  total: number;
}

export function rollUp(groups: readonly GroupDefinition[], relationships: readonly RepositoryRelationship[]): Rollup {
  const groupsOf = new Map<string, string[]>();
  for (const group of groups) for (const member of group.members) groupsOf.set(member, [...(groupsOf.get(member) ?? []), group.key]);

  const internal = new Map<string, Set<string>>();
  const between = new Map<string, { from: string; to: string; pairs: Set<string>; edgeIds: Set<string> }>();
  for (const relationship of relationships) {
    if (relationship.from === relationship.to) continue;
    const pair = `${relationship.from}\u0000${relationship.to}`;
    for (const from of groupsOf.get(relationship.from) ?? []) {
      for (const to of groupsOf.get(relationship.to) ?? []) {
        if (from === to) {
          internal.set(from, (internal.get(from) ?? new Set()).add(pair));
          continue;
        }
        const key = `${from}\u0000${to}`;
        const entry = between.get(key) ?? { from, to, pairs: new Set<string>(), edgeIds: new Set<string>() };
        entry.pairs.add(pair);
        entry.edgeIds.add(relationship.edgeId);
        between.set(key, entry);
      }
    }
  }

  return {
    groups: groups.map((group) => ({ key: group.key, label: group.label, repositories: group.members.size, internal: internal.get(group.key)?.size ?? 0 })),
    relationships: [...between.values()]
      .map((entry) => ({ from: entry.from, to: entry.to, repositoryRelationships: entry.pairs.size, edgeIds: [...entry.edgeIds].sort(compare) }))
      .sort((a, b) => b.repositoryRelationships - a.repositoryRelationships || compare(a.from, b.from) || compare(a.to, b.to)),
    total: new Set(groups.flatMap((group) => [...group.members])).size,
  };
}

/** Keys that name groups across levels, so links and tests agree on them. */
export const groupKey = {
  lineOfBusiness: (id: string | null) => `lob:${id ?? "none"}`,
  portal: (id: string) => `portal:${id}`,
  application: (id: string) => `application:${id}`,
  repository: (nodeId: string) => `repo:${nodeId}`,
  system: (id: string) => `system:${id}`,
  unassigned: "unassigned",
} as const;

export interface Labels {
  lineOfBusiness(id: string | null): string;
  portal(id: string): string;
  application(id: string): string;
  system(id: string): string;
}

/**
 * The Run level: each Line of Business with every repository listed under it,
 * including those listed under portals of other Lines of Business, and
 * Unassigned.
 */
export function runLevelGroups(placements: ReadonlyMap<string, readonly Placement[]>, labels: Labels): GroupDefinition[] {
  const groups = new Map<string, GroupDefinition & { members: Set<string> }>();
  const add = (key: string, label: string, member: string) => {
    const group = groups.get(key) ?? { key, label, members: new Set<string>() };
    group.members.add(member);
    groups.set(key, group);
  };
  for (const [node, placed] of placements) {
    for (const placement of placed) {
      if (placement.kind === "unassigned") add(groupKey.unassigned, "Unassigned", node);
      else add(groupKey.lineOfBusiness(placement.lineOfBusiness), labels.lineOfBusiness(placement.lineOfBusiness), node);
    }
  }
  return sortGroups([...groups.values()]);
}

/**
 * One Line of Business: its portals, the applications in no portal, and the
 * portals of other Lines of Business that its repositories appear in.
 */
export function lineOfBusinessGroups(placements: ReadonlyMap<string, readonly Placement[]>, lineOfBusiness: string | null, applicationOf: ReadonlyMap<string, string>, labels: Labels): { portals: GroupDefinition[]; applications: GroupDefinition[]; otherPortals: GroupDefinition[] } {
  const portals = new Map<string, Set<string>>();
  const applications = new Map<string, Set<string>>();
  const otherPortals = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, member: string) => map.set(key, (map.get(key) ?? new Set()).add(member));
  for (const [node, placed] of placements) {
    for (const placement of placed) {
      if (placement.kind === "portal" && placement.lineOfBusiness === lineOfBusiness) add(portals, placement.portal, node);
      else if (placement.kind === "other_portal" && placement.lineOfBusiness === lineOfBusiness) add(otherPortals, placement.portal, node);
      else if (placement.kind === "line_of_business" && placement.lineOfBusiness === lineOfBusiness) add(applications, applicationOf.get(node)!, node);
    }
  }
  return {
    portals: sortGroups([...portals].map(([id, members]) => ({ key: groupKey.portal(id), label: labels.portal(id), members }))),
    applications: sortGroups([...applications].map(([id, members]) => ({ key: groupKey.application(id), label: labels.application(id), members }))),
    otherPortals: sortGroups([...otherPortals].map(([id, members]) => ({ key: groupKey.portal(id), label: labels.portal(id), members }))),
  };
}

/** One portal: the repositories placed in it, grouped by SEAL application. */
export function portalGroups(placements: ReadonlyMap<string, readonly Placement[]>, portal: string, applicationOf: ReadonlyMap<string, string>, labels: Labels): GroupDefinition[] {
  const applications = new Map<string, Set<string>>();
  for (const [node, placed] of placements) {
    if (!placed.some((placement) => placement.kind === "portal" && placement.portal === portal)) continue;
    const application = applicationOf.get(node)!;
    applications.set(application, (applications.get(application) ?? new Set()).add(node));
  }
  return sortGroups([...applications].map(([id, members]) => ({ key: groupKey.application(id), label: labels.application(id), members })));
}

/** Unassigned: each runtime system as a group. */
export function unassignedGroups(placements: ReadonlyMap<string, readonly Placement[]>, labels: Labels): GroupDefinition[] {
  const systems = new Map<string, Set<string>>();
  for (const [node, placed] of placements) {
    for (const placement of placed) if (placement.kind === "unassigned") systems.set(placement.system, (systems.get(placement.system) ?? new Set()).add(node));
  }
  return sortGroups([...systems].map(([id, members]) => ({ key: groupKey.system(id), label: labels.system(id), members })));
}

function sortGroups<T extends GroupDefinition>(groups: T[]): T[] {
  return groups.sort((a, b) => (a.key === groupKey.unassigned ? 1 : 0) - (b.key === groupKey.unassigned ? 1 : 0) || compare(a.label, b.label) || compare(a.key, b.key));
}
