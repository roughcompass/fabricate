import { describe, expect, it } from "vitest";
import { resolveView } from "@/lib/demo/access";
import { referenceUrl } from "@/lib/demo/deployments";
import { runtimeDescriptor } from "@/lib/demo/runtime-view";
import { createTestDb } from "../support/db";

describe("reference deployments", () => {
  it("gives each reference deployment one address, which preview mode and the running application share", () => {
    expect(referenceUrl("payments-workspace")).toBe("https://payments-workspace-preview.deweb.example");
    const db = createTestDb();
    try {
      const view = resolveView(db, "ref-payments-workspace", null)!;
      expect(runtimeDescriptor(view, null, null).url).toBe(referenceUrl("payments-workspace"));
    } finally {
      db.$client.close();
    }
  });

  it("runs in production and links back to its template's page", () => {
    const db = createTestDb();
    try {
      const descriptor = runtimeDescriptor(resolveView(db, "ref-market-watch", null)!, null, null);
      expect(descriptor).toMatchObject({ applicationId: "ref-market-watch", environment: "production", access: "reference", pageHref: "/templates/market-watch" });
    } finally {
      db.$client.close();
    }
  });
});
