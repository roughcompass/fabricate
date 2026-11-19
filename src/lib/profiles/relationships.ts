import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { newestProfileIds } from "@/lib/profiling/current";
import { assessments, graphEdges, graphNodes, initiatives, repositorySources } from "@/lib/db/schema";
import { routes } from "@/lib/web/routes";

/**
 * How a repository relates to the other repositories of the newest
 * Assessment Run that mapped it: the repositories it uses, such as the
 * Module Federation remotes it composes or the packages it depends on, and
 * the repositories that use it. Relationships exist only within one Run's
 * Relationship Map (docs/projection.md), so a repository that no Assessment
 * Run has mapped has no known relationships, which isn't the same as none.
 *
 * Reads only the projection, by index: a few queries whatever the Run's size.
 */
export interface RelatedRepository {
  /** The other repository's public id, such as `src_…`. */
  publicId: string;
  name: string;
  /** The relationship types between them, such as `composition` or `package_dependency`. */
  types: string[];
}

export interface RepositoryRelationships {
  /** The Run whose map they come from, or null when no Assessment Run has mapped the repository. */
  run: { publicId: string; finishedAt: Date | null } | null;
  uses: RelatedRepository[];
  usedBy: RelatedRepository[];
  /** The repository's focus in that Run's Relationship Map. */
  mapHref: string | null;
}

const NONE: RepositoryRelationships = { run: null, uses: [], usedBy: [], mapHref: null };

export function repositoryRelationships(db: Executor, sourceId: number): RepositoryRelationships {
  // The newest Assessment Run, not a profile version's own one-repository Run, in which nothing else can appear.
  const node = db
    .select({ mapId: graphNodes.mapId, nodeId: graphNodes.nodeId, run: assessments.publicId, finishedAt: assessments.finishedAt })
    .from(graphNodes)
    .innerJoin(assessments, eq(assessments.id, graphNodes.assessmentId))
    .innerJoin(initiatives, eq(initiatives.id, assessments.initiativeId))
    .where(and(eq(graphNodes.repositorySourceId, sourceId), eq(graphNodes.kind, "repository"), eq(initiatives.profiling, false)))
    .orderBy(desc(graphNodes.mapId))
    .limit(1)
    .get();
  if (!node) return NONE;

  const edges = db
    .select({ type: graphEdges.type, from: graphEdges.fromNode, to: graphEdges.toNode })
    .from(graphEdges)
    .where(and(eq(graphEdges.mapId, node.mapId), eq(graphEdges.state, "resolved"), eq(graphEdges.kind, "architecture"), or(eq(graphEdges.fromNode, node.nodeId), eq(graphEdges.toNode, node.nodeId))))
    .all();
  const others = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]).filter((id): id is string => id !== null && id !== node.nodeId))];
  const repositories = new Map(
    (others.length
      ? db
          .select({ nodeId: graphNodes.nodeId, publicId: repositorySources.publicId, name: repositorySources.name })
          .from(graphNodes)
          .innerJoin(repositorySources, eq(repositorySources.id, graphNodes.repositorySourceId))
          .where(and(eq(graphNodes.mapId, node.mapId), eq(graphNodes.kind, "repository"), inArray(graphNodes.nodeId, others)))
          .all()
      : []
    ).map((row) => [row.nodeId, row]),
  );

  const collect = (direction: "uses" | "usedBy") => {
    const related = new Map<string, RelatedRepository>();
    for (const edge of edges) {
      const other = direction === "uses" ? (edge.from === node.nodeId ? edge.to : null) : edge.to === node.nodeId ? edge.from : null;
      const repository = other ? repositories.get(other) : undefined;
      if (!repository) continue;
      const entry = related.get(repository.publicId) ?? { publicId: repository.publicId, name: repository.name, types: [] };
      if (!entry.types.includes(edge.type)) entry.types.push(edge.type);
      related.set(repository.publicId, entry);
    }
    return [...related.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  return { run: { publicId: node.run, finishedAt: node.finishedAt }, uses: collect("uses"), usedBy: collect("usedBy"), mapHref: routes.runMap(node.run, { focus: node.nodeId }) };
}

/** A cataloged repository that produces a package. */
export interface PackageProducer {
  publicId: string;
  name: string;
}

/**
 * The cataloged repositories that produce each of +names+, by their current
 * Profiles: a dependency one of them produces is internal to the fleet, not
 * a vendor's. A package name is matched exactly; a private
 * workspace package with a common name can match a vendor's, so each match
 * names its producer. Reads the projection by index, so it stays cheap at
 * 200 to 500 repositories.
 */
export function packageProducers(db: Executor, names: readonly string[]): Map<string, PackageProducer[]> {
  const producers = new Map<string, PackageProducer[]>();
  if (!names.length) return producers;
  const rows = db.all<{ package: string; publicId: string; name: string }>(sql`
    SELECT DISTINCT package.label AS package, source.public_id AS publicId, source.name AS name
    FROM graph_edges edge
    JOIN graph_nodes package ON package.map_id = edge.map_id AND package.node_id = edge.to_node
    JOIN graph_nodes producer ON producer.map_id = edge.map_id AND producer.node_id = edge.from_node
    JOIN repository_sources source ON source.id = producer.repository_source_id
    JOIN repository_profiles profile ON profile.assessment_target_id = producer.assessment_target_id
    WHERE edge.type = 'package_production'
      AND profile.id IN ${newestProfileIds(db)}
      AND package.label IN (${sql.join(names.map((name) => sql`${name}`), sql`, `)})
    ORDER BY source.name`);
  for (const row of rows) producers.set(row.package, [...(producers.get(row.package) ?? []), { publicId: row.publicId, name: row.name }]);
  return producers;
}
