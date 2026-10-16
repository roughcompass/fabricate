import { beforeEach, describe, expect, it } from "vitest";
import { getSource, owningApplication, owningApplications, updateSource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { repositorySources } from "@/lib/db/schema";
import { registerApplication } from "../support/applications";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { onboardPortal } from "../support/onboarding";
import { captureValidation } from "../support/validation";

/*
 * A Repository an Application is registered from (make-applications-first-
 * class task 10.1): the Repositories list names the Application, and the
 * Repository's clone URL can't change while the Application exists.
 */

describe("a Repository an Application is registered from", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("refuses a clone URL change, naming the Application, and leaves the Repository unchanged", () => {
    const application = registerApplication(db, { name: "Payee Hub", portal: onboardPortal(db, "Access") });
    const source = db.select().from(repositorySources).all().find((row) => row.id === application.repositorySourceId)!;

    const error = captureValidation(() => updateSource(db, source.publicId, source.lockVersion, { cloneUrl: "https://github.com/acme/elsewhere.git", canonicalUrl: "https://github.com/acme/elsewhere" }));
    expect(error.issues).toEqual([{ field: "cloneUrl", message: "Payee Hub is registered from this Repository, so its clone URL can't change" }]);
    expect(getSource(db, source.publicId)).toMatchObject({ cloneUrl: source.cloneUrl, lockVersion: source.lockVersion });
  });

  it("still takes a new name or reference", () => {
    const application = registerApplication(db, { name: "Payee Hub", portal: onboardPortal(db, "Access") });
    const source = db.select().from(repositorySources).all().find((row) => row.id === application.repositorySourceId)!;
    expect(updateSource(db, source.publicId, source.lockVersion, { name: "payee-hub-main", gitRef: "main" })).toMatchObject({ name: "payee-hub-main", gitRef: "main", cloneUrl: source.cloneUrl });
  });

  it("changes the clone URL of a Repository no Application is registered from", () => {
    const source = buildSource(db, { name: "orders" });
    expect(owningApplication(db, source.id)).toBeUndefined();
    expect(updateSource(db, source.publicId, source.lockVersion, { cloneUrl: "https://github.com/acme/orders-2.git", canonicalUrl: "https://github.com/acme/orders-2" }).cloneUrl).toBe("https://github.com/acme/orders-2.git");
  });

  it("names each Repository's Application in one read", () => {
    const access = onboardPortal(db, "Access");
    const payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
    const ledger = registerApplication(db, { name: "Ledger", portal: access });
    buildSource(db, { name: "orders" });
    const owners = owningApplications(db);
    expect(owners.size).toBe(2);
    expect(owners.get(payeeHub.repositorySourceId!)).toEqual({ publicId: payeeHub.publicId, name: "Payee Hub" });
    expect(owners.get(ledger.repositorySourceId!)).toEqual({ publicId: ledger.publicId, name: "Ledger" });
  });
});
