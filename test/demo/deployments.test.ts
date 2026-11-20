import { describe, expect, it } from "vitest";
import { templateBySlug } from "@/lib/demo/catalog";
import { referenceUrl } from "@/lib/demo/deployments";
import { runtimeDescriptor } from "@/lib/demo/runtime-view";

describe("reference deployments", () => {
  it("gives each reference deployment one address, which preview mode and the running application share", () => {
    expect(referenceUrl("payments-workspace")).toBe("https://payments-workspace-preview.deweb.example");
    expect(runtimeDescriptor(templateBySlug("payments-workspace")!, null).url).toBe(referenceUrl("payments-workspace"));
  });

  it("runs in production, links back to its template's page, and has no share link or session profiles, which belong to applications", () => {
    const descriptor = runtimeDescriptor(templateBySlug("market-watch")!, null);
    expect(descriptor).toMatchObject({ applicationId: "ref-market-watch", environment: "production", access: "reference", pageHref: "/templates/market-watch", shareState: null, shareToken: null, profiles: [] });
  });
});
