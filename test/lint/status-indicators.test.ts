import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Status } from "@/components/ui/status";

/** Lines in src matching +pattern+; git grep exits 1 when nothing matches, which here is the good case. */
function grep(pattern: string): string[] {
  try {
    return execFileSync("git", ["grep", "-n", "-E", pattern, "--", "src"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

// An indicator and its text are one component, so the gap between them is the same everywhere (design-system docs, "Status and values").
describe("status indicators", () => {
  it("never shows a bare indicator beside text a page placed itself", () => {
    // A Status with an empty label is an indicator alone, with the page's own text beside it at whatever gap its container sets.
    expect(grep("<Status[^>]*label=(\"\"|\\{\"\"\\}|'')")).toEqual([]);
  });

  it("marks content in place of the state's label, the indicator level with its first line", () => {
    const html = renderToStaticMarkup(createElement(Status, { state: "observed" }, createElement("a", { href: "/x" }, "TypeScript")));
    expect(html).toContain('data-content=""');
    expect(html).toContain('<a href="/x">TypeScript</a>');
    expect(html).not.toContain("Observed");
    expect(renderToStaticMarkup(createElement(Status, { state: "unknown", size: "sm" }))).toContain(">Unknown<");
  });
});
