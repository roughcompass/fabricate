import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIDEBAR_WIDTH, parseSidebarHidden, parseSidebarWidth } from "@/lib/web/sidebar";

// operator-interface/page-patterns spec: the sidebar can be resized and hidden.

describe("sidebar preferences", () => {
  it.each([
    ["256", 256],
    ["320", 320],
    ["199", 200],
    ["9999", 400],
    ["abc", 256],
    ["320px", 256],
    ["-1", 256],
    ["", 256],
    [undefined, 256],
  ])("reads the stored width %j as %i", (stored, width) => {
    expect(parseSidebarWidth(stored)).toBe(width);
  });

  it("is hidden only when the cookie says so", () => {
    expect(parseSidebarHidden("hidden")).toBe(true);
    expect(parseSidebarHidden("shown")).toBe(false);
    expect(parseSidebarHidden(undefined)).toBe(false);
  });

  it("matches the size tokens in globals.css", () => {
    const globals = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");
    const token = (name: string) => Number(new RegExp(`${name}: (\\d+)px;`).exec(globals)?.[1]);
    expect([token("--size-sidebar"), token("--size-sidebar-min"), token("--size-sidebar-max")]).toEqual([SIDEBAR_WIDTH.default, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max]);
  });
});
