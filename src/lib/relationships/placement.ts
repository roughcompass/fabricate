/*
 * The runtime systems of a Run (relationship-maps spec, "Maps are reviewed by
 * runtime system"): repositories tied together by composition, iframe, and
 * runtime-contract links. A repository with no such link stands alone, as a
 * system of one. Pure: the caller supplies the repositories and their links,
 * so the rules are tested directly.
 */

export interface SystemRepository {
  nodeId: string;
  label: string;
}

/** A link that ties two repositories into one runtime system: composition, iframe, or a runtime contract. */
export interface RuntimeLink {
  from: string;
  to: string;
  type: "composition" | "iframe" | "runtime_contract";
}

export interface RuntimeSystem {
  /** The node ID of the repository the system is named for: its host, or its first repository by name. */
  id: string;
  name: string;
  /** The repository with outgoing composition links, if there is one. */
  host: string | null;
  members: string[];
}

/** The repositories joined by their runtime links, by union-find, each system named for its host or its first repository. */
export function runtimeSystems(repositories: readonly SystemRepository[], links: readonly RuntimeLink[]): RuntimeSystem[] {
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

/** Code-unit order, so the same input always sorts the same way, whatever the locale. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
