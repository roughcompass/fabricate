import { describe, expect, it } from "vitest";
import { routes } from "@/lib/web/routes";

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
