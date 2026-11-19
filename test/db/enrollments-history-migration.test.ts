import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "@/lib/repositories/repository-records";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";
import { queuedPreview } from "../support/previews";

/*
 * Migration 0055 (add-applications): preview enrollments, one per canonical
 * remote, and each application's build history, whose builds are previews of
 * its own Repository and package, deleted with the application.
 */

const T0 = 1_795_000_000_000;

describe("enrollments and build history migration", () => {
  let db: Db;
  let repository: Repository;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const count = (table: string) => (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

  beforeEach(() => {
    db = createTestDb(migrationFolderAt("0054_applications"));
    repository = buildRepository(db, { name: "spa-orders" });
    migrateUpTo(db, "0055_enrollments_and_build_history");
  });
  afterEach(() => db.$client.close());

  it("enrolls each remote once, by its canonical identity", () => {
    run("insert into preview_enrollments (canonical_url, application_public_id, application_name, created_at) values (?, 'app_0000000000000001', 'Orders portal', ?)", repository.canonicalUrl, T0);
    expect(() => run("insert into preview_enrollments (canonical_url, application_public_id, application_name, created_at) values (?, 'app_0000000000000002', 'Admin', ?)", repository.canonicalUrl, T0)).toThrow(/UNIQUE constraint failed: preview_enrollments.canonical_url/);
    expect(() => run("insert into preview_enrollments (canonical_url, application_public_id, application_name, created_at) values ('https://x', 'src_0000000000000001', 'Admin', ?)", T0)).toThrow(/preview_enrollments_application/);
  });

  it("keeps an application's history of its own builds, and deletes it with the application", () => {
    const created = onboard(db, withOverrides(getConfig(), { previews: { enabled: true } }), repository);
    expect(count("application_builds")).toBe(1);
    expect(count("preview_enrollments")).toBe(1);
    const other = queuedPreview(db, buildRepository(db, { name: "spa-admin" }));
    const otherId = (db.$client.prepare("select id from preview_builds where public_id = ?").get(other.publicId) as { id: number }).id;
    expect(() => run("update application_builds set preview_id = ?, attempt = 1", otherId)).toThrow(/a build is a preview of the application's Repository and package at its commit/);
    expect(() => run("update application_builds set outcome = 'ready'")).toThrow(/application_builds_finished/);
    expect(() => run("update application_builds set outcome = 'failed', finished_at = ?", T0)).toThrow(/application_builds_reasons/);

    run("delete from applications where public_id = ?", created.publicId);
    expect(count("application_builds")).toBe(0);
    // The enrollment stays.
    expect(count("preview_enrollments")).toBe(1);
  });
});
