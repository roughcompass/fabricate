import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { StaleRecordError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { createInitiative, getInitiative, scopeLabel, selectedSources, updateInitiative } from "@/lib/initiatives/initiative-records";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { captureValidation } from "../support/validation";

describe("initiative records", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("records the all-Repositories policy without copying catalog membership", () => {
    buildSource(db);
    const initiative = createInitiative(db, { name: "Modernize", objective: "Upgrade", selectionMode: "all" });

    expect(isPublicId(initiative.publicId, "ini")).toBe(true);
    expect(selectedSources(db, initiative.id)).toEqual([]);
    expect(scopeLabel(initiative, 0)).toBe("All Repositories");
  });

  it("records exactly the explicitly selected sources", () => {
    const [first, second] = [buildSource(db, { name: "b" }), buildSource(db, { name: "a" }), buildSource(db)];
    const initiative = createInitiative(db, { name: "Subset", selectionMode: "explicit", sourcePublicIds: [first!.publicId, second!.publicId, first!.publicId] });

    expect(selectedSources(db, initiative.id).map((source) => source.name)).toEqual(["a", "b"]);
  });

  it("requires a name and at least one source for an explicit scope", () => {
    const error = captureValidation(() => createInitiative(db, { name: " ", selectionMode: "explicit" }));

    expect(error.messagesFor("name")).toEqual(["Enter a name"]);
    expect(error.messagesFor("sources")).toEqual(["Select at least one repository source for an explicit scope"]);
  });

  it("rejects unknown sources with one message each", () => {
    const known = buildSource(db, { name: "legacy" });
    const error = captureValidation(() =>
      createInitiative(db, { name: "Invalid", selectionMode: "explicit", sourcePublicIds: [known.publicId, "src_missingmissingmi", "src_missingmissing2"] }),
    );

    expect(error.messagesFor("sources")).toEqual(["Repository source src_missingmissingmi does not exist", "Repository source src_missingmissing2 does not exist"]);
  });

  it("clears explicit selections when switching to all Repositories", () => {
    const initiative = buildInitiative(db, { sources: [buildSource(db)] });
    const updated = updateInitiative(db, initiative.publicId, 0, { name: initiative.name, selectionMode: "all", sourcePublicIds: [] });

    expect(updated.selectionMode).toBe("all");
    expect(selectedSources(db, updated.id)).toEqual([]);
  });

  it("uses optimistic locking", () => {
    const initiative = buildInitiative(db);
    updateInitiative(db, initiative.publicId, 0, { name: "First", selectionMode: "all" });

    expect(() => updateInitiative(db, initiative.publicId, 0, { name: "Second", selectionMode: "all" })).toThrow(StaleRecordError);
    expect(getInitiative(db, initiative.publicId).name).toBe("First");
  });

  it("loads selections through relations", () => {
    const source = buildSource(db, { name: "orders" });
    const initiative = buildInitiative(db, { sources: [source] });

    const loaded = db.query.initiatives.findFirst({ where: (table, { eq }) => eq(table.id, initiative.id), with: { targets: { with: { repositorySource: true } } } }).sync();
    expect(loaded?.targets.map((target) => target.repositorySource.name)).toEqual(["orders"]);
  });

  describe("database rules", () => {
    it("rejects unsupported selection modes and blank names", () => {
      const initiative = buildInitiative(db);

      expect(() => rawRun(db, "update initiatives set selection_mode = 'everything' where id = ?", initiative.id)).toThrow(/CHECK constraint failed/);
      expect(() => rawRun(db, "update initiatives set name = '' where id = ?", initiative.id)).toThrow(/CHECK constraint failed/);
    });

    it("rejects explicit selections on an initiative of all Repositories", () => {
      const initiative = buildInitiative(db);
      const source = buildSource(db);

      expect(() => rawRun(db, "insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, ?, 0)", initiative.id, source.id)).toThrow(
        /only explicit initiatives/,
      );
    });

    it("rejects switching to all Repositories while selections remain", () => {
      const initiative = buildInitiative(db, { sources: [buildSource(db)] });

      expect(() => rawRun(db, "update initiatives set selection_mode = 'all' where id = ?", initiative.id)).toThrow(/remove explicit selections/);
    });

    it("rejects duplicate selections", () => {
      const source = buildSource(db);
      const initiative = buildInitiative(db, { sources: [source] });

      expect(() => rawRun(db, "insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, ?, 0)", initiative.id, source.id)).toThrow(
        /UNIQUE constraint failed/,
      );
    });
  });
});
