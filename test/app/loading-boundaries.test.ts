import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { skeletonFor } from "@/components/shell/skeleton-routes";

// A navigation shows the skeleton of the page being opened: its template's
// skeleton (page-templates spec, "Every template has designed empty and loading states").
describe("navigation skeletons", () => {
  it.each([
    ["/", "dashboard"],
    ["/admin/system", "dashboard"],
    ["/adoption", "dashboard"],
    ["/adoption/design-systems/salt", "analysis"],
    ["/adoption/design-systems/salt/components/Button", "details-tabs"],
    ["/adoption/packages/@salt-ds/core", "analysis"],
    ["/assessments", "index-tabs"],
    ["/repositories", "repositories"],
    ["/repositories/bulk", "form"],
    ["/standards", "index"],
    ["/admin/bitbucket-tokens", "index"],
    ["/admin/bitbucket-tokens/new", "form"],
    ["/assessments/new", "form"],
    ["/assessments/ini_abc/edit", "form"],
    ["/repositories/new", "form"],
    ["/repositories/src_abc", "details-tabs"],
    ["/repositories/src_abc/versions", "index"],
    ["/repositories/src_abc/versions/3", "details-tabs"],
    ["/repositories/src_abc/settings", "settings"],
    ["/repositories/src_abc/previews/pvw_abc", "focused"],
    ["/standards/new", "form"],
    ["/standards/std_abc/edit", "form"],
    ["/standards/std_abc/publish", "form"],
    ["/assessments/ini_abc", "details"],
    ["/runs/asm_abc", "details"],
    ["/runs/asm_abc/map", "analysis"],
    ["/runs/asm_abc/map/systems/sys_1", "analysis"],
    ["/runs/asm_abc/evidence/ev_1", "details"],
    ["/evaluations/evl_abc", "details"],
    ["/evaluations/evl_abc/findings/fnd_1", "details"],
    ["/profiles/prf_abc", "details-tabs"],
    ["/profiles/prf_abc/evidence/ev_1", "details"],
    ["/standards/std_abc", "details"],
    ["/standards/std_abc/draft", "editor"],
    ["/standards/std_abc/releases/rel_1", "details"],
    ["/applications", "cards"],
    ["/applications/orders-portal", "details"],
    ["/applications/orders-portal/settings", "settings"],
    ["/applications/orders-portal/preview", "focused"],
    ["/templates", "cards"],
    ["/templates/market-watch", "details"],
    ["/templates/market-watch/preview", "focused"],
    ["/templates/payments-workspace/preview", "focused"],
    ["/templates/payments-workspace", "details"],
    ["/docs", "content"],
    ["/docs/get-started/add-your-repository", "content"],
  ])("shows the %s page's skeleton as %s", (pathname, kind) => {
    expect(skeletonFor(pathname)).toBe(kind);
  });

  it("shows no skeleton for pages outside the product", () => {
    expect(skeletonFor("/design-system")).toBeNull();
    expect(skeletonFor("/api/health")).toBeNull();
    expect(skeletonFor("/run/ref-market-watch/watch")).toBeNull();
    expect(skeletonFor("/s/token")).toBeNull();
    expect(skeletonFor("/portals/ptl_abc")).toBeNull();
    expect(skeletonFor("/about")).toBeNull();
  });

  it("has a not-found page for each section", () => {
    expect(fs.existsSync(path.resolve("src/app/not-found.tsx")), "root").toBe(true);
    for (const section of ["adoption", "applications", "assessments", "runs", "evaluations", "profiles", "repositories", "standards", "templates"]) {
      expect(fs.existsSync(path.resolve("src/app/(operator)", section, "not-found.tsx")), section).toBe(true);
    }
  });

  // The templates' skeletons show while a navigation waits, through NavigationFeedback, rather than from loading.tsx:
  // a Suspense boundary streams the page behind its fallback, which only a script reveals, so a browser without
  // JavaScript would see only the skeleton, and a page that isn't found would answer 200.
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
