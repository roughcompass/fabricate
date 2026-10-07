import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { acceptanceRelationships, seedAcceptance } from "../support/acceptance";
import { createTestDb } from "../support/db";
import { loadV1Fixture, migratedV1Database, revisionDigests, v1Snapshot } from "../support/onboarding-v1";

/** Every public ID of the onboarding records, in creation order. */
function publicIds(db: Db) {
  return Object.fromEntries(
    ["portals", "applications", "microfrontends", "application_placements", "placement_decisions", "external_references"].map((table) => [table, (db.$client.prepare(`select public_id from ${table} order by id`).pluck().all() as string[])]),
  );
}

/** Public IDs from a seeded sequence and one fixed instant, so a seed is the same on every run. */
function deterministic() {
  let state = 20261004;
  vi.spyOn(crypto, "randomInt").mockImplementation(((max: number) => {
    state = (state * 48271) % 2147483647;
    return state % max;
  }) as typeof crypto.randomInt);
  vi.useFakeTimers({ now: new Date("2026-10-04T08:00:00Z"), toFake: ["Date"] });
}

// The onboarding acceptance fixtures (simplify-web-onboarding task 10.1): the same relationships on every run.
describe("onboarding acceptance fixture", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("describes the same Portals, MFEs, Applications, and decisions on every run", () => {
    const first = acceptanceRelationships(createTestDb());
    const second = acceptanceRelationships(createTestDb());
    expect(second).toEqual(first);
    expect(first).toEqual({
      portals: [
        { name: "Access", sealId: "88001", lifecycle: "active", environments: ["prod", "uat"], menu: ["payments"], defaults: [["prod", "Payee hub"], ["uat", "Payee hub"]] },
        { name: "Markets", sealId: "88002", lifecycle: "ready", environments: ["prod", "uat"], menu: ["payments"], defaults: [["prod", null], ["uat", null]] },
      ],
      mfes: [
        { name: "Payee hub", lifecycle: "ready", cdaas: "payee/payee-hub", usedBy: [["Payee hub", "entry", null]] },
        {
          name: "Payee search",
          lifecycle: "ready",
          cdaas: "payee/payee-search",
          usedBy: [
            ["Payee hub", "child", "Slot search"],
            ["Payments reporting", "child", "Route /reports/search"],
          ],
        },
      ],
      applications: [
        {
          name: "Payee hub",
          sealId: "88001",
          lifecycle: "ready",
          launch: ["mfe", "module_federation_2", "inferred", "Payee hub"],
          components: [
            ["Payee hub", "entry", null],
            ["Payee search", "child", "search"],
          ],
          placements: [
            ["Access", "approved", "approved", ["prod", "uat"], "any: PAYEE_VIEW"],
            ["Markets", "rejected", "rejected", ["prod"], "any: none"],
          ],
        },
        {
          name: "Payments reporting",
          sealId: "88001",
          lifecycle: "ready",
          launch: ["external", "iframe", "explicit", null],
          components: [["Payee search", "child", "/reports/search"]],
          placements: [["Access", "approved", "approved", ["prod"], "all: PAYMENTS_ADMIN, REPORTS_VIEW"]],
        },
      ],
    });
  });

  it("gives every record a public ID of its kind, distinct between runs", () => {
    const first = seedAcceptance(createTestDb());
    const second = seedAcceptance(createTestDb());
    expect([first.access.publicId, first.hub.publicId, first.composite.publicId]).toEqual([expect.stringMatching(/^ptl_/), expect.stringMatching(/^mfe_/), expect.stringMatching(/^wap_/)]);
    expect(second.composite.publicId).not.toBe(first.composite.publicId);
  });

  it("seeds a v2 fixture identically with the same IDs and clock: the same public relationships and revision digests", () => {
    const seeded = () => {
      deterministic();
      const db = createTestDb();
      const relationships = acceptanceRelationships(db);
      const result = { relationships, ids: publicIds(db), digests: revisionDigests(db), formats: db.$client.prepare("select distinct format_version as version from application_revisions").all() };
      vi.restoreAllMocks();
      vi.useRealTimers();
      return result;
    };
    const first = seeded();
    expect(seeded()).toEqual(first);
    expect(first.formats).toEqual([{ version: 2 }]);
    expect((first.digests.application_revisions ?? []).every((revision) => (revision as { digest: string | null }).digest !== null)).toBe(true);
  });

  it("loads the v1 fixture identically every time: the same public IDs, rows, and digests v1 wrote", () => {
    const load = () => {
      const db = createTestDb();
      loadV1Fixture(db);
      return { ids: publicIds(db), rows: v1Snapshot(db), digests: revisionDigests(db) };
    };
    const first = load();
    expect(load()).toEqual(first);
    const migrated = migratedV1Database();
    expect(first.digests).toEqual(revisionDigests(migrated));
    expect(first.rows).toEqual(v1Snapshot(migrated));
  });
});
