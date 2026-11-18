import type { Db } from "@/lib/db/client";
import { manifest } from "./profiles";

/** Every table of the assessment projection. */
export const PROJECTION_TABLES = ["dependency_facts", "graph_nodes", "graph_edges", "graph_edge_candidates", "evidence_index", "concept_classifications", "projection_coverage"] as const;

/** An npm lockfile, version 3, that pins each dependency of +name+ to a version. */
function lockfile(name: string, versions: Record<string, string>): string {
  const packages: Record<string, unknown> = { "": { name, version: "1.0.0", dependencies: Object.fromEntries(Object.keys(versions).map((dependency) => [dependency, `^${versions[dependency]}`])) } };
  for (const [dependency, version] of Object.entries(versions)) packages[`node_modules/${dependency}`] = { version };
  return manifest({ name, version: "1.0.0", lockfileVersion: 3, requires: true, packages });
}

/** A repository that depends on +dependencies+, with each pinned in a lockfile. */
export function pinnedRepository(name: string, dependencies: Record<string, string>) {
  return {
    // Published, as a package another repository depends on must be.
    "package.json": manifest({ name, version: "1.0.0", dependencies: Object.fromEntries(Object.keys(dependencies).map((dependency) => [dependency, `^${dependencies[dependency]}`])) }),
    "package-lock.json": lockfile(name, dependencies),
  };
}

export function count(db: Db, table: string, where = "1 = 1", ...params: unknown[]): number {
  return (db.$client.prepare(`select count(*) as n from ${table} where ${where}`).get(...params) as { n: number }).n;
}

/** The projection's rows, without row ids, in a stable order: what a rebuild must reproduce. */
export function projectionRows(db: Db): Record<string, unknown[]> {
  const rows: Record<string, unknown[]> = {};
  for (const table of PROJECTION_TABLES) {
    const columns = (db.$client.prepare(`select name from pragma_table_info('${table}') where name <> 'id' order by cid`).all() as { name: string }[]).map((column) => column.name);
    rows[table] = db.$client.prepare(`select ${columns.join(", ")} from ${table} order by ${columns.join(", ")}`).all();
  }
  return rows;
}
