import type { Run } from "@/lib/runs/run-records";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { buildAssessment, buildRepository } from "./builders";
import { manifest } from "./profiles";
import { seedRun } from "./scenarios";

const name = (index: number) => `repo-${String(index).padStart(3, "0")}`;

/**
 * A Run at the scale the projection is sized for: +repositories+ libraries,
 * each depending on react and on up to two earlier libraries, seeded through
 * the real profiling, resolution, and projection paths.
 */
export async function seedLargeRun(db: Db, count = 500): Promise<{ run: Run; repositories: Repository[] }> {
  const repositories = Array.from({ length: count }, (_, index) => buildRepository(db, { name: name(index) }));
  const assessment = buildAssessment(db, { name: "Large Run", repositories });
  const outcomes = repositories.map((_, index) => {
    const dependencies: Record<string, string> = { react: "^18.0.0" };
    if (index > 0) dependencies[`@fleet/${name(index - 1)}`] = "^1.0.0";
    if (index > 1) dependencies[`@fleet/${name(Math.floor(index / 2))}`] = "^1.0.0";
    return { "package.json": manifest({ name: `@fleet/${name(index)}`, version: "1.0.0", dependencies }) };
  });
  return { run: await seedRun(db, assessment, repositories, outcomes), repositories };
}
