import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importSources } from "@/app/(operator)/sources/import/actions";
import { listSources } from "@/lib/catalog/source-records";
import { type Db, setDb } from "@/lib/db/client";
import { createTestDb } from "../support/db";
import { redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

describe("directory import Server Action", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    setDb(db);
  });
  afterEach(() => setDb(undefined));

  it("asks for a selection instead of reporting an empty import", async () => {
    const form = new FormData();
    form.set("directory", "/srv/repositories");
    const location = await redirectOf(importSources(form));
    expect(location).toBe(`/sources/import?directory=${encodeURIComponent("/srv/repositories")}&notice=none-selected`);
    expect(listSources(db)).toEqual([]);
  });
});
