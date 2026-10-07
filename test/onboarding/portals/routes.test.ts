import { describe, expect, it } from "vitest";
import { isNormalizedRoute, normalizeRoute } from "@/lib/onboarding/routes";

describe("Portal route normalization", () => {
  it.each([
    ["/payments", "/payments"],
    ["  /payments  ", "/payments"],
    ["/payments/", "/payments"],
    ["//payments///reports//", "/payments/reports"],
    ["/", "/"],
    ["///", "/"],
    ["/Payments", "/Payments"],
    ["/payee-search/~drafts/a:b@c", "/payee-search/~drafts/a:b@c"],
  ])("normalizes %j to %j", (input, route) => {
    expect(normalizeRoute(input)).toEqual({ route, problem: null });
  });

  it.each([
    ["", "empty"],
    ["payments", "leading_slash"],
    ["payments/reports", "leading_slash"],
    ["/payments?tab=open", "query"],
    ["/payments#reports", "fragment"],
    ["/payments/../admin", "dot_segment"],
    ["/./payments", "dot_segment"],
    ["/pay ments", "characters"],
    ["/payments/<script>", "characters"],
    ["/paiements/é", "characters"],
    [`/${"a".repeat(200)}`, "too_long"],
  ])("refuses %j as %s", (input, problem) => {
    expect(normalizeRoute(input)).toEqual({ route: null, problem });
  });

  it("matches routes case-sensitively", () => {
    expect(normalizeRoute("/Payments").route).not.toBe(normalizeRoute("/payments").route);
    expect(isNormalizedRoute("/payments")).toBe(true);
    expect(isNormalizedRoute("/payments/")).toBe(false);
  });
});
