import { describe, expect, it } from "vitest";
import { loadConfig, withOverrides } from "@/lib/config";
import { judgePair } from "@/lib/prototypes/pipeline/pairwise";
import type { PersonaCopy } from "@/lib/prototypes/types";

const settings = withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { review: "mock" } } }).prototypes;
const maya: PersonaCopy = { id: "per_aaaaaaaaaaaaaaaa", name: "Maya Lindqvist", role: "Treasury payments approver", organizationType: "", goals: ["Release urgent payments"], context: "", constraints: [], distinction: null };

// quality-checks spec, "Two versions can be judged pairwise on request"; design.md, decision 10.
describe("pairwise review", () => {
  it("names the better version when both orderings agree, calling it by its name rather than its position (Pairwise review)", async () => {
    const verdicts = await judgePair("Review and release urgent payments", [maya], { number: 4, code: "v4" }, { number: 2, code: "v2" }, settings);
    expect(verdicts).toEqual([{ personaId: maya.id, personaName: "Maya Lindqvist", winner: "a", reasons: ["v4 keeps the cut-off in view."] }]);
    const reversed = await judgePair("Review and release urgent payments", [maya], { number: 2, code: "v2" }, { number: 4, code: "v4" }, settings);
    expect(reversed[0]?.winner).toBe("b");
  });

  it("is undecided when swapping the order changes the verdict", async () => {
    const verdicts = await judgePair("Review and release urgent payments #mock-position-bias", [maya], { number: 4, code: "v4" }, { number: 2, code: "v2" }, settings);
    expect(verdicts[0]?.winner).toBe("undecided");
    expect(verdicts[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("judges the intent alone when the versions have no persona", async () => {
    const verdicts = await judgePair("Review and release urgent payments", [], { number: 3, code: "v3" }, { number: 1, code: "v1" }, settings);
    expect(verdicts).toMatchObject([{ personaId: null, personaName: "The intent", winner: "a" }]);
  });
});
