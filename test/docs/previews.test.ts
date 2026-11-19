import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";

/*
 * docs/previews.md's account of automatic rebuilds (add-applications, task
 * 3.2) matches the schedule the worker keeps: the profiling check's, once per
 * profiling.checkMinutes, whose default the committed configuration sets.
 */

const doc = fs.readFileSync("docs/previews.md", "utf8");
const section = (heading: string) => {
  const start = doc.indexOf(`\n### ${heading}\n`);
  expect(start, heading).toBeGreaterThan(0);
  const end = doc.indexOf("\n##", start + heading.length + 6);
  return doc.slice(start, end === -1 ? undefined : end);
};

describe("docs/previews.md", () => {
  it("documents automatic rebuilds on the profiling check's schedule, with its setting, default, and variable", () => {
    const rebuilds = section("Automatic rebuilds");
    const { profiling } = loadConfig({ appRoot: process.cwd(), environment: "production", env: {} });
    expect(rebuilds).toContain(`once per \`profiling.checkMinutes\` (default ${profiling.checkMinutes}, \`FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES\`), and once when it starts, in the same \`profiling.check\` job`);
    expect(rebuilds).toContain("four remotes at a time");
  });

  it("documents the screenshot's size, wait, limit, and files as the capture takes them", () => {
    const screenshots = section("Screenshots");
    for (const fact of ["1440 by 900 pixels", "500 milliseconds without network requests, up to 20 seconds", "`screenshot.webp` and a 720-pixel-wide `card.webp`", "`npx playwright install chromium`"]) expect(screenshots).toContain(fact);
  });
});
