import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Visual rules that live in one place, so they can't drift: a component
 * stylesheet uses the shared token or component instead of restating it.
 * The template demo's runtime has its own theme and is left out.
 */

const files = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return full.includes(`${path.sep}runtime`) ? [] : files(full);
    return entry.name.endsWith(".module.css") ? [full] : [];
  });
const stylesheets = files(path.resolve("src")).map((file) => ({ file: path.relative(process.cwd(), file), css: fs.readFileSync(file, "utf8") }));
const offending = (pattern: RegExp) => stylesheets.flatMap(({ file, css }) => css.split("\n").flatMap((line, index) => (pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])));

describe("one source for each visual rule", () => {
  it("draws keyboard focus with the focus-ring tokens, outside or inset, never a ring of its own", () => {
    expect(offending(/outline:\s*\d+px solid var\(--color-focus\)/)).toEqual([]);
    expect(offending(/outline-offset:\s*-?\d/).filter((line) => !line.includes("design-system.module.css"))).toEqual([]);
  });

  it("maps tones to colors only in the shared tone map (indicator.module.css)", () => {
    expect(offending(/\[data-tone="(success|warning|error|info|progress)"\][^{]*\{[^}]*--_tone:/).filter((line) => !line.includes("indicator.module.css") && !line.includes("alert.module.css"))).toEqual([]);
  });

  it("draws a state's dot only in Indicator, not with a dot of its own", () => {
    expect(offending(/width:\s*var\(--size-dot\)/).filter((line) => !/indicator\.module\.css|form\.module\.css|device-frame\.module\.css|timing\.module\.css/.test(line))).toEqual([]);
  });

  it("draws a content surface with the surface tokens, not its own border, corners, and fill", () => {
    expect(offending(/border:\s*1px solid var\(--color-border\);\s*border-radius:\s*var\(--radius-lg\)/)).toEqual([]);
  });
});
