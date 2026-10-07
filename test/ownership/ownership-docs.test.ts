import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every example in docs/ownership.md names the test that covers it, in the
// last column of its table. Each named test must exist.
const doc = fs.readFileSync(path.resolve("docs/ownership.md"), "utf8");
const sources = ["test/ownership", "test/db"].flatMap((folder) =>
  fs
    .readdirSync(path.resolve(folder))
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => fs.readFileSync(path.resolve(folder, file), "utf8")),
);
const titles = sources.flatMap((source) => [...source.matchAll(/\bit\(\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1")));

/** The backticked names in the "Test" column of every table that has one. */
function namedTests(markdown: string): string[] {
  const names: string[] = [];
  let column = -1;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      column = -1;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (column === -1) {
      column = cells.indexOf("Test");
      continue;
    }
    const cell = cells[column];
    if (!cell || /^-+$/.test(cell)) continue;
    for (const match of cell.matchAll(/`([^`]+)`/g)) names.push(match[1]!);
  }
  return names;
}

describe("ownership documentation", () => {
  it("names a test for every example, and each named test exists", () => {
    const names = namedTests(doc);
    expect(names.length).toBeGreaterThan(15);
    expect(names.filter((name) => !titles.some((title) => title.includes(name)))).toEqual([]);
  });

  it("names the tests for the read limits it describes", () => {
    for (const name of ["refuses to follow a redirect, so the token goes nowhere else", "gives up on a DE Console that doesn't answer in time"]) {
      expect(doc).toContain(name);
      expect(titles).toContain(name);
    }
  });
});
