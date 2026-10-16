import { describe, expect, it } from "vitest";
import type { ControlRecheck } from "@/lib/prototypes/conformance";
import type { GateResult } from "@/lib/prototypes/types";
import { COVERAGE, buildUpgradeReport, craterResult, reportMarkdown } from "@/lib/prototypes/upgrade-report";

// template-conformance spec: "An upgrade report lists every template's results" (design decision 10 of converge-templates-and-prototypes).

const gate = (name: GateResult["gate"], status: GateResult["status"]): GateResult => ({ gate: name, status, durationMs: 1, issues: [], warnings: [] }) as unknown as GateResult;
const PASSING = [gate("salt-only", "passed"), gate("typecheck", "passed"), gate("salt-usage", "passed"), gate("build", "passed")];

const controls = (changes: ControlRecheck["controls"]): ControlRecheck => ({ status: "unchanged", evaluationId: "evl_upgrade000000000", controls: changes });

/** Fixture results for one Salt upgrade: a template that holds, one whose Control regresses, one Broken by a gate, and one not evaluated at acceptance. */
const REPORT = buildUpgradeReport("4d34913713a3", "1.74.0", [
  {
    template: "Urgent payments queue",
    templateVersion: 2,
    acceptedGates: PASSING,
    recheckGates: PASSING,
    controls: controls([
      { release: "Salt exemplary v1", key: "salt-exemplary-token-share", control: "Styles only with Salt tokens", before: "meets", after: "meets", status: "unchanged" },
      { release: "Salt adherence v1", key: "salt-adoption", control: "Uses Salt components", before: "not_applicable", after: "not_applicable", status: "unchanged" },
    ]),
  },
  {
    template: "Cut-off timeline",
    templateVersion: 1,
    acceptedGates: PASSING,
    recheckGates: PASSING,
    controls: controls([
      { release: "Salt exemplary v1", key: "salt-exemplary-unknown-tokens", control: "No unknown Salt tokens", before: "meets", after: "gap", status: "regressed" },
      { release: "Salt exemplary v1", key: "salt-exemplary-raw-equivalents", control: "No raw elements that Salt replaces", before: "gap", after: "meets", status: "fixed" },
    ]),
  },
  {
    template: "Bulk release",
    templateVersion: 1,
    acceptedGates: PASSING,
    recheckGates: [gate("salt-only", "passed"), gate("typecheck", "failed"), gate("salt-usage", "passed"), gate("build", "passed")],
    controls: controls([{ release: "Salt exemplary v1", key: "salt-exemplary-token-share", control: "Styles only with Salt tokens", before: "meets", after: null, status: "broken" }]),
  },
  { template: "Payee-first summary", templateVersion: 3, acceptedGates: PASSING, recheckGates: PASSING, controls: null },
]);

describe("the upgrade report", () => {
  it("classifies each check as salt-fleet-crater does", () => {
    expect(craterResult("passes", "passes")).toBe("unchanged");
    expect(craterResult("passes", "fails")).toBe("regressed");
    expect(craterResult("fails", "passes")).toBe("fixed");
    expect(craterResult("fails", "fails")).toBe("broken");
    expect(craterResult("passes", null)).toBe("broken");
  });

  it("lists every template's gates and Controls with their baseline, candidate, and result, and what the checks don't cover (Report after an upgrade)", () => {
    expect(REPORT.coverage).toBe(COVERAGE);
    expect(REPORT.counts).toEqual({ unchanged: 17, regressed: 2, fixed: 1, broken: 1 });
    expect(REPORT.rows.filter((row) => row.template === "Bulk release").map((row) => [row.check, row.result])).toContainEqual(["Typecheck gate", "regressed"]);
    expect(REPORT).toMatchSnapshot();
  });

  it("renders the same report as Markdown with crater's columns", () => {
    expect(reportMarkdown(REPORT)).toMatchSnapshot();
  });
});
