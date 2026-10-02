import type { Assessment } from "@/lib/assessments/assessment-records";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { buildInitiative, buildSource } from "./builders";
import { manifest } from "./profiles";
import { seedAssessment } from "./scenarios";

const name = (index: number) => `repo-${String(index).padStart(3, "0")}`;

/**
 * A Run at the scale the projection is sized for: +repositories+ libraries,
 * each depending on react and on up to two earlier libraries, seeded through
 * the real profiling, resolution, and projection paths.
 */
export async function seedLargeRun(db: Db, repositories = 500): Promise<{ assessment: Assessment; sources: RepositorySource[] }> {
  const sources = Array.from({ length: repositories }, (_, index) => buildSource(db, { name: name(index) }));
  const initiative = buildInitiative(db, { name: "Large Run", sources });
  const outcomes = sources.map((_, index) => {
    const dependencies: Record<string, string> = { react: "^18.0.0" };
    if (index > 0) dependencies[`@fleet/${name(index - 1)}`] = "^1.0.0";
    if (index > 1) dependencies[`@fleet/${name(Math.floor(index / 2))}`] = "^1.0.0";
    return { "package.json": manifest({ name: `@fleet/${name(index)}`, version: "1.0.0", dependencies }) };
  });
  return { assessment: await seedAssessment(db, initiative, sources, outcomes), sources };
}
