import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ApplicationPage from "@/app/(operator)/runs/[assessmentId]/map/seal/[sealId]/page";
import PortalPage from "@/app/(operator)/runs/[assessmentId]/map/portal/[portal]/page";
import MapPage from "@/app/(operator)/runs/[assessmentId]/map/page";
import { type Db, setDb } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { type LargeMap, seedLargeMap } from "../support/large-map";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

// Once +forbid+ is set, reading or verifying any stored document fails the test.
const guard = vi.hoisted(() => ({ forbid: false, reads: 0 }));
vi.mock("@/lib/documents/digested", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/digested")>();
  return {
    ...actual,
    readDocument: (...args: Parameters<typeof actual.readDocument>) => {
      if (guard.forbid) {
        guard.reads++;
        throw new Error(`A stored document was read: ${args[2]}`);
      }
      return actual.readDocument(...args);
    },
  };
});
vi.mock("@/lib/relationships/map-records", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/relationships/map-records")>();
  return {
    ...actual,
    mapDocument: (...args: Parameters<typeof actual.mapDocument>) => {
      if (guard.forbid) {
        guard.reads++;
        throw new Error("mapDocument was called");
      }
      return actual.mapDocument(...args);
    },
  };
});

/** Server time for one request: the page's data and its markup. */
async function timed(render: () => Promise<React.ReactElement>): Promise<{ milliseconds: number; html: string }> {
  const start = performance.now();
  const html = renderToStaticMarkup(await render());
  return { milliseconds: performance.now() - start, html };
}

const BUDGET = 500;

describe("Relationship Map at 500 repositories (Large Run)", () => {
  let db: Db;
  let large: LargeMap;
  let nodeOf: (name: string) => string;

  beforeAll(async () => {
    db = createTestDb();
    setDb(db);
    large = await seedLargeMap(db);
    nodeOf = (name) => (db.$client.prepare("select node_id from graph_nodes where kind = 'repository' and label = ?").get(name) as { node_id: string }).node_id;
    guard.forbid = true;
  }, 180_000);

  afterAll(() => {
    guard.forbid = false;
    setDb(undefined);
  });

  const run = () => Promise.resolve({ assessmentId: large.assessment.publicId });
  const views: [string, () => Promise<React.ReactElement>][] = [
    ["the Run level", () => MapPage({ params: run(), searchParams: Promise.resolve({}) })],
    ["a portal level", () => PortalPage({ params: Promise.resolve({ assessmentId: large.assessment.publicId, portal: large.portals[3]!.publicId }), searchParams: Promise.resolve({}) })],
    ["a SEAL application level", () => ApplicationPage({ params: Promise.resolve({ assessmentId: large.assessment.publicId, sealId: "SEAL-A0300" }), searchParams: Promise.resolve({}) })],
    ["a library's focus", () => MapPage({ params: run(), searchParams: Promise.resolve({ focus: nodeOf("lib-00") }) })],
  ];

  it("is seeded at scale, with claims across Lines of Business and portals", () => {
    const count = (sql: string) => (db.$client.prepare(sql).get() as { n: number }).n;
    expect(count("select count(*) as n from graph_nodes where kind = 'repository'")).toBe(500);
    expect(count("select count(distinct subject_repository_source_id) as n from ownership_assertions where attribute = 'seal_id'")).toBe(440);
    expect(count("select count(*) as n from graph_edges where kind = 'architecture' and state = 'resolved'")).toBeGreaterThan(1000);
  });

  for (const [name, render] of views) {
    it(`builds ${name} within ${BUDGET} ms without reading a map or Profile document`, async () => {
      await timed(render); // warm the module and statement caches
      const { milliseconds, html } = await timed(render);

      expect(html).toContain("Relationship Map");
      expect(guard.reads).toBe(0);
      expect(milliseconds, `${name} took ${Math.round(milliseconds)} ms`).toBeLessThan(BUDGET);
    });
  }

  it("leads the library's focus with its dependents across portals", async () => {
    const { html } = await timed(views[3]![1]);

    expect(html).toMatch(/Changing lib-00 directly affects \d+ repositories in \d+ portals; \d+ more depend on it through them\./);
  });
});
