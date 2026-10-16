import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { skeletonFor } from "@/components/shell/skeleton-routes";

// A navigation shows the skeleton of the page being opened (design.md, decision 9).
describe("navigation skeletons", () => {
  it.each([
    ["/", "home"],
    ["/assessments", "list"],
    ["/repositories", "list"],
    ["/repositories/import", "list"],
    ["/standards", "list"],
    ["/assessments/new", "form"],
    ["/assessments/ini_abc/edit", "form"],
    ["/repositories/new", "form"],
    ["/repositories/src_abc/edit", "form"],
    ["/repositories/de-console", "detail"],
    ["/standards/new", "form"],
    ["/standards/std_abc/edit", "form"],
    ["/assessments/ini_abc", "detail"],
    ["/runs/asm_abc", "detail"],
    ["/runs/asm_abc/map", "detail"],
    ["/runs/asm_abc/evidence/ev_1", "detail"],
    ["/evaluations/evl_abc", "detail"],
    ["/evaluations/evl_abc/findings/fnd_1", "detail"],
    ["/profiles/prf_abc", "detail"],
    ["/standards/std_abc", "detail"],
    ["/standards/std_abc/draft", "detail"],
    ["/standards/std_abc/releases/rel_1", "detail"],
    ["/templates", "list"],
    ["/templates/market-watch", "detail"],
    ["/templates/market-watch/deploy", "form"],
    ["/templates/market-watch/preview", "focused"],
    ["/templates/payments-workspace/preview", "focused"],
    ["/templates/payments-workspace/deploy", "form"],
    ["/templates/payments-workspace", "detail"],
    ["/applications", "list"],
    ["/applications/app_abc", "detail"],
    ["/applications/wap_abc", "detail"],
    ["/applications/new", "focused"],
    ["/applications/new/templates", "focused"],
    ["/applications/new/create", "focused"],
    ["/navigation", "list"],
    ["/navigation/new", "form"],
    ["/navigation/ptl_abc", "detail"],
  ])("shows the %s page's skeleton as %s", (pathname, kind) => {
    expect(skeletonFor(pathname)).toBe(kind);
  });

  it("shows no skeleton for pages outside the product", () => {
    expect(skeletonFor("/design-system")).toBeNull();
    expect(skeletonFor("/api/health")).toBeNull();
    expect(skeletonFor("/run/ref-market-watch/watch")).toBeNull();
    expect(skeletonFor("/s/token")).toBeNull();
  });

  it("has a not-found page for each section", () => {
    expect(fs.existsSync(path.resolve("src/app/not-found.tsx")), "root").toBe(true);
    for (const section of ["assessments", "runs", "evaluations", "profiles", "repositories", "standards", "templates", "applications"]) {
      expect(fs.existsSync(path.resolve("src/app/(operator)", section, "not-found.tsx")), section).toBe(true);
    }
  });

  it("uses no route loading files, which would stream large pages behind a skeleton", () => {
    const found: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(directory, entry.name));
        else if (/^loading\.(tsx|ts|jsx|js)$/.test(entry.name)) found.push(path.join(directory, entry.name));
      }
    };
    walk(path.resolve("src/app"));
    expect(found).toEqual([]);
  });
});
