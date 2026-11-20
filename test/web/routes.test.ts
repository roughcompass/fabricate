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
