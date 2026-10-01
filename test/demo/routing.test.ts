import { describe, expect, it } from "vitest";
import { memberById, templateBySlug } from "@/lib/demo/catalog";
import { availableEnvironments, environmentLabel, resolveRouting, routingHeaders } from "@/lib/demo/routing";

const app = templateBySlug("payments-workspace")!.app;

describe("microfrontend routing", () => {
  it("serves every member from the sandbox in a sandbox application", () => {
    const routing = resolveRouting(app, "sandbox");
    expect(Object.values(routing).every((member) => member.environment === "sandbox" && member.reason === "default")).toBe(true);
    expect(routing["payee-list"]!.version).toBe("1.4.2");
  });

  it("serves child members from dev and the portal shell from production as a fallback in a dev application", () => {
    const routing = resolveRouting(app, "dev");
    expect(routing["payments-shell"]).toMatchObject({ environment: "production", reason: "fallback" });
    expect(environmentLabel(routing["payments-shell"]!)).toBe("Production (fallback)");
    for (const member of ["payee-list", "transfer-form", "payment-activity"]) expect(routing[member]).toMatchObject({ environment: "dev", reason: "default" });
    expect(environmentLabel(routing["payee-list"]!)).toBe("Dev");
  });

  it("serves reference deployments from production", () => {
    expect(Object.values(resolveRouting(app, "production")).every((member) => member.environment === "production" && member.reason === "default")).toBe(true);
  });

  it("applies valid overrides with the override reason and ignores invalid ones", () => {
    const routing = resolveRouting(app, "sandbox", {
      "payee-list": { version: "2.1.0-beta.1", environment: "sandbox" },
      "transfer-form": { version: "3.1.0", environment: "production" },
      "payment-activity": { version: "9.9.9", environment: "sandbox" },
      "payments-shell": { version: "5.2.0", environment: "dev" },
    });
    expect(routing["payee-list"]).toEqual({ member: "payee-list", version: "2.1.0-beta.1", environment: "sandbox", reason: "override" });
    expect(routing["transfer-form"]).toMatchObject({ version: "3.1.0", environment: "production", reason: "override" });
    expect(routing["payment-activity"]).toMatchObject({ version: "2.3.0", reason: "default" });
    expect(routing["payments-shell"]).toMatchObject({ environment: "sandbox", reason: "default" });
  });

  it("resets to the defaults when the overrides are cleared", () => {
    const overridden = resolveRouting(app, "dev", { "payee-list": { version: "2.0.0", environment: "dev" } });
    expect(overridden["payee-list"]!.reason).toBe("override");
    expect(resolveRouting(app, "dev", {})).toEqual(resolveRouting(app, "dev"));
  });

  it("offers production plus the environment a member was built in", () => {
    const shell = memberById(app, "payments-shell")!;
    const child = memberById(app, "payee-list")!;
    expect(availableEnvironments(child, "sandbox")).toEqual(["production", "sandbox"]);
    expect(availableEnvironments(child, "dev")).toEqual(["production", "dev"]);
    expect(availableEnvironments(shell, "dev")).toEqual(["production"]);
    expect(availableEnvironments(child, "production")).toEqual(["production"]);
  });

  it("describes a routing decision as simulated response headers", () => {
    expect(routingHeaders(resolveRouting(app, "dev")["payments-shell"]!)).toEqual([
      ["x-demo-mfe", "payments-shell"],
      ["x-demo-mfe-version", "5.2.0"],
      ["x-demo-mfe-environment", "production"],
      ["x-demo-mfe-reason", "fallback"],
    ]);
  });
});
