import { describe, expect, it } from "vitest";
import { listSources } from "@/lib/catalog/source-records";
import { ownershipFilterOf, repositoryCounts } from "@/lib/ownership/coverage";
import { repositoryOwnership } from "@/lib/ownership/read";
import { createApplication } from "@/lib/ownership/records";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { claim, readDeConsole } from "../support/home";

describe("ownership coverage", () => {
  it("counts claimed Repositories exactly as repositoryOwnership resolves them (Conflicting claims still count as claimed)", () => {
    const db = createTestDb();
    const [plain, superseded, conflicting, consoleLinked, disabledClaimed] = [buildSource(db), buildSource(db), buildSource(db), buildSource(db), buildSource(db, { enabled: false })];
    buildSource(db); // unclaimed
    buildSource(db, { enabled: false }); // disabled and unclaimed

    claim(db, plain!);
    // A correction that supersedes the earlier claim keeps the Repository claimed.
    const first = claim(db, superseded!);
    claim(db, superseded!, { application: first.application, providedBy: "Bo", supersedes: [first.assertion.id] });
    // Two people name different applications: in conflict, but claimed.
    claim(db, conflicting!, { providedBy: "Ana" });
    claim(db, conflicting!, { providedBy: "Bo" });
    // A DE Console application linked by a claim.
    readDeConsole(db, [{ seal_id: "88001", team: "Access Platform" }], new Date());
    const consoleApplication = createApplication(db, { sealId: "88002" });
    claim(db, consoleLinked!, { application: consoleApplication });
    claim(db, disabledClaimed!);

    const enabled = listSources(db, { enabled: true });
    const owned = repositoryOwnership(db, enabled.map((source) => source.id));
    const claimedByReader = enabled.filter((source) => ownershipFilterOf(owned.get(source.id)) === "claimed").length;
    expect(owned.get(conflicting!.id)!.application.conflict).toBe(true);

    expect(repositoryCounts(db)).toEqual({ total: 7, enabled: 5, claimed: 4, unclaimed: 1 });
    expect(claimedByReader).toBe(4);
  });

  it("counts nothing in an empty catalog", () => {
    expect(repositoryCounts(createTestDb())).toEqual({ total: 0, enabled: 0, claimed: 0, unclaimed: 0 });
  });
});
