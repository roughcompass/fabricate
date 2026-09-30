import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { skeletonFor } from "@/components/shell/skeleton-routes";

// A navigation shows the skeleton of the page being opened (design.md, decision 9).
describe("navigation skeletons", () => {
  it.each([
    ["/", "list"],
    ["/sources", "list"],
    ["/sources/import", "list"],
    ["/standards", "list"],
    ["/initiatives/new", "form"],
    ["/initiatives/ini_abc/edit", "form"],
    ["/sources/new", "form"],
    ["/sources/src_abc/edit", "form"],
    ["/standards/new", "form"],
    ["/standards/std_abc/edit", "form"],
    ["/initiatives/ini_abc", "detail"],
    ["/assessments/asm_abc", "detail"],
    ["/assessments/asm_abc/map", "detail"],
    ["/assessments/asm_abc/evidence/ev_1", "detail"],
    ["/evaluations/evl_abc", "detail"],
    ["/evaluations/evl_abc/findings/fnd_1", "detail"],
    ["/profiles/prf_abc", "detail"],
    ["/standards/std_abc", "detail"],
    ["/standards/std_abc/draft", "detail"],
    ["/standards/std_abc/releases/rel_1", "detail"],
  ])("shows the %s page's skeleton as %s", (pathname, kind) => {
    expect(skeletonFor(pathname)).toBe(kind);
  });

  it("shows no skeleton for pages outside the product", () => {
    expect(skeletonFor("/design-system")).toBeNull();
    expect(skeletonFor("/api/health")).toBeNull();
  });

  it("has a not-found page for each section", () => {
    for (const section of ["", "initiatives", "assessments", "evaluations", "profiles", "sources", "standards"]) {
      expect(fs.existsSync(path.resolve("src/app", section, "not-found.tsx")), section || "root").toBe(true);
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
