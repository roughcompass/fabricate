import { type RuntimeSystem, compare } from "./placement";

/*
 * Rolling repository relationships up into relationships between groups
 * (design decisions 3 and 5). A level's groups are sets of repositories.
 * Each relationship between two repositories
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
  repository: (nodeId: string) => `repo:${nodeId}`,
  system: (id: string) => `system:${id}`,
} as const;

/** The Run level: each runtime system, a repository on its own included, as a group, by name. */
export function systemGroups(systems: readonly RuntimeSystem[]): GroupDefinition[] {
  return systems.map((system) => ({ key: groupKey.system(system.id), label: system.name, members: new Set(system.members) })).sort((a, b) => compare(a.label, b.label) || compare(a.key, b.key));
}
