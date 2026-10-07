import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApplicationRevisionPage from "@/app/(operator)/onboarding/applications/[applicationId]/revisions/[revision]/page";
import MicrofrontendRevisionPage from "@/app/(operator)/onboarding/microfrontends/[microfrontendId]/revisions/[revision]/page";
import PortalRevisionPage from "@/app/(operator)/onboarding/portals/[portalId]/revisions/[revision]/page";
import { type Db, setDb } from "@/lib/db/client";
import { migratedV1Database } from "../support/onboarding-v1";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

/*
 * Revisions submitted before revision format versions stay readable as
 * history: each v1 Portal, Application, and MFE revision page still shows
 * the runtimes, contracts, entitlements, and stated identities it was
 * submitted with.
 */

/** Every string and number a server-rendered tree carries, in its children and its props. */
function textOf(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") found.push(String(node));
  else if (Array.isArray(node)) for (const item of node) textOf(item, found);
  else if (isValidElement<Record<string, unknown>>(node)) for (const value of Object.values(node.props)) textOf(value, found);
  else if (node !== null && typeof node === "object" && !(node instanceof Date)) for (const value of Object.values(node)) textOf(value, found);
  return found;
}

const text = (tree: ReactNode) => textOf(tree).join("\n");

describe("v1 revision history", () => {
  let db: Db;
  const publicId = (table: string, column: string, name: string) => (db.$client.prepare(`select public_id as id from ${table} where ${column} = ?`).get(name) as { id: string }).id;

  beforeEach(() => {
    db = migratedV1Database();
    setDb(db);
  });

  afterEach(() => {
    setDb(undefined);
    db.$client.close();
  });

  it("shows a v1 Portal revision's runtimes, entitlements, contract, and submitter", async () => {
    const page = text(await PortalRevisionPage({ params: Promise.resolve({ portalId: publicId("portals", "label", "Access"), revision: "1" }) }));

    expect(page).toContain("studio-shell");
    expect(page).toContain("ACCESS_UAT");
    expect(page).toContain("Error boundary, Events, Navigation, Session context, Theme");
    expect(page).toContain("https://payments.example.com");
    expect(page).toContain("portal.navigate");
    expect(page).toContain("ana@example.com");
  });

  it("shows a v1 Application revision's environments, required capabilities, host contract, and placements", async () => {
    const approvals = text(await ApplicationRevisionPage({ params: Promise.resolve({ applicationId: publicId("applications", "name", "Payments approvals"), revision: "1" }) }));
    expect(approvals).toContain("PROD, UAT");
    expect(approvals).toContain("Navigation");
    expect(approvals).toContain("/approvals");
    expect(approvals).toContain("ana@example.com");

    const reporting = text(await ApplicationRevisionPage({ params: Promise.resolve({ applicationId: publicId("applications", "name", "Payments reporting"), revision: "1" }) }));
    expect(reporting).toContain("External host contract");
    expect(reporting).toContain("https://payments.example.com/reports");
    expect(reporting).toContain('{"permissions":[],"sandbox":["allow-scripts"]}');
  });

  it("shows a v1 MFE revision's contract and submitter", async () => {
    const page = text(await MicrofrontendRevisionPage({ params: Promise.resolve({ microfrontendId: publicId("microfrontends", "name", "Payee hub"), revision: "1" }) }));

    expect(page).toContain("./App");
    expect(page).toContain("portal.navigate");
    expect(page).toContain("payee.selected");
    expect(page).toContain("react");
    expect(page).toContain("ana@example.com");
  });
});
