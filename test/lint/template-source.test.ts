import { describe, expect, it } from "vitest";
import { TemplateBuildError, buildTemplates } from "@/lib/prototypes/heroes/build";

/**
 * Every built-in template's committed Salt source passes DE FabLab's gates
 * with no exemptions, and names only tokens Salt's theme defines
 * (portal-runtime spec, "Template source passes DE FabLab's gates"), as
 * `npm run templates:build` checks before it writes.
 */
describe("committed template source", () => {
  it("passes every gate for every template, page, and shell", async () => {
    const problems = await buildTemplates()
      .then(() => [])
      .catch((error: unknown) => (error instanceof TemplateBuildError ? error.problems.map((problem) => `${problem.file}: ${problem.message}`) : [String(error)]));
    expect(problems).toEqual([]);
  }, 300_000);
});
