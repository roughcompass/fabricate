import { describe, expect, it } from "vitest";
import { parseRunSegment, routes } from "@/lib/web/routes";

/*
 * A running application's address (add-applications: query strings through
 * /run/<slug>): the application's route with its own query, every parameter
 * as it was, and a share link's token after it.
 */

describe("a running application's address", () => {
  it("keeps the application's route and its own query, adding a share link's token", () => {
    expect(routes.runningApplication("orders-portal")).toBe("/run/orders-portal");
    expect(routes.runningApplication("orders-portal", "/")).toBe("/run/orders-portal");
    expect(routes.runningApplication("orders-portal", "/accounts/42")).toBe("/run/orders-portal/accounts/42");
    expect(routes.runningApplication("orders-portal", "/accounts?tab=billing")).toBe("/run/orders-portal/accounts?tab=billing");
    expect(routes.runningApplication("orders-portal", "/accounts?tab=billing&tag=a&tag=b", { share: "t0ken" })).toBe("/run/orders-portal/accounts?tab=billing&tag=a&tag=b&share=t0ken");
    expect(routes.runningApplication("orders-portal", "/?q=north%20wind", { share: null })).toBe("/run/orders-portal?q=north+wind");
  });

  it("gives a share link's token precedence over a parameter of the same name", () => {
    expect(routes.runningApplication("orders-portal", "/accounts?share=old", { share: "t0ken" })).toBe("/run/orders-portal/accounts?share=t0ken");
  });
});

describe("a saved preview's addresses (restore-toolbar-tools-and-branch-previews, design decision 4)", () => {
  it("runs a saved preview at /run/<slug>@<key>, keeping the route, its query, and a share link's token", () => {
    expect(routes.runningApplication("orders-portal", "", undefined, "feature-new-nav")).toBe("/run/orders-portal@feature-new-nav");
    expect(routes.runningApplication("orders-portal", "/accounts/42?tab=billing", { share: "t0ken" }, "feature-new-nav")).toBe("/run/orders-portal@feature-new-nav/accounts/42?tab=billing&share=t0ken");
    expect(routes.runningApplication("orders-portal", "/accounts", undefined, null)).toBe("/run/orders-portal/accounts");
  });

  it("splits a run segment at its first @, and reads an encoded one", () => {
    expect(parseRunSegment("orders-portal")).toEqual({ slug: "orders-portal", key: null });
    expect(parseRunSegment("orders-portal@feature-new-nav")).toEqual({ slug: "orders-portal", key: "feature-new-nav" });
    expect(parseRunSegment("orders-portal%40v1.1.0")).toEqual({ slug: "orders-portal", key: "v1.1.0" });
    expect(parseRunSegment("orders-portal@a@b")).toEqual({ slug: "orders-portal", key: "a@b" });
    expect(parseRunSegment("orders%E0%A4%A")).toEqual({ slug: "orders%E0%A4%A", key: null });
  });

  it("names a saved preview's screenshot, New preview, and preview mode on it", () => {
    expect(routes.applicationScreenshot("orders-portal", "v1", "card", "feature-new-nav")).toBe("/applications/orders-portal/screenshot?preview=feature-new-nav&size=card&v=v1");
    expect(routes.newApplicationPreview("orders-portal")).toBe("/applications/orders-portal/previews/new");
    expect(routes.applicationPreview("orders-portal", { preview: "feature-new-nav", device: "tablet" })).toBe("/applications/orders-portal/preview?preview=feature-new-nav&device=tablet");
  });
});

describe("mock sets' addresses (add-mock-sets, design decision 18, task 4.1)", () => {
  const set = "mks_0000000000000001";

  it("names the section, a set's page and forms, uploads and their review, and a saved preview's choice", () => {
    expect(routes.applicationMockSets("orders-portal")).toBe("/applications/orders-portal#mock-sets");
    expect(routes.mockSet("orders-portal", set, { page: 2, state: "needs-response" })).toBe(`/applications/orders-portal/mock-sets/${set}?page=2&state=needs-response`);
    expect(routes.newMockSet("orders-portal", { from: "failed-calls" })).toBe("/applications/orders-portal/mock-sets/new?from=failed-calls");
    expect(routes.mockSetEdit("orders-portal", set)).toBe(`/applications/orders-portal/mock-sets/${set}/edit`);
    expect(routes.newMockRule("orders-portal", set, { from: "3" })).toBe(`/applications/orders-portal/mock-sets/${set}/rules/new?from=3`);
    expect(routes.mockRule("orders-portal", set, "mkr_0000000000000001")).toBe(`/applications/orders-portal/mock-sets/${set}/rules/mkr_0000000000000001`);
    expect(routes.mockSetUpload("orders-portal", { set })).toBe(`/applications/orders-portal/mock-sets/upload?set=${set}`);
    expect(routes.mockSetImport("orders-portal", "mki_0000000000000001", { page: 2 })).toBe("/applications/orders-portal/mock-sets/imports/mki_0000000000000001?page=2");
    expect(routes.savedPreviewMockSet("orders-portal", "feature-new-nav")).toBe("/applications/orders-portal/previews/feature-new-nav/mock-set");
  });

  it("names the endpoints", () => {
    expect(routes.mockSetsApi("orders-portal", { preview: "feature-new-nav" })).toBe("/api/applications/orders-portal/mock-sets?preview=feature-new-nav");
    expect(routes.mockSetChoiceApi("orders-portal")).toBe("/api/applications/orders-portal/mock-sets/choice");
    expect(routes.mockRulesApi("orders-portal", set)).toBe(`/api/applications/orders-portal/mock-sets/${set}/rules`);
    expect(routes.compiledMockSet("orders-portal", set, 4)).toBe(`/api/applications/orders-portal/mock-sets/${set}/compiled?revision=4`);
    expect(routes.compiledMockSet("orders-portal", set)).toBe(`/api/applications/orders-portal/mock-sets/${set}/compiled`);
    expect(routes.mockSetBody("orders-portal", set, "a".repeat(64))).toBe(`/api/applications/orders-portal/mock-sets/${set}/bodies/${"a".repeat(64)}`);
    expect(routes.mockSetImportsApi("orders-portal")).toBe("/api/applications/orders-portal/mock-sets/imports");
    expect(routes.mockSetHar("orders-portal", set)).toBe(`/api/applications/orders-portal/mock-sets/${set}/har`);
  });
});
