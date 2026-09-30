import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, themeTokens } from "../support/css";

// Every foreground and background pairing the design system uses meets WCAG
// contrast in both themes: 4.5:1 for text, 3:1 for control boundaries and focus.
const globals = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");

const BACKGROUNDS = ["--color-bg", "--color-bg-subtle", "--color-bg-muted", "--color-bg-elevated"];
const STATUSES = ["success", "warning", "error", "neutral", "progress"];

const PAIRS: (readonly [foreground: string, background: string, minimum: number])[] = [
  ...BACKGROUNDS.flatMap((background) => [
    ["--color-text", background, 4.5] as const,
    ["--color-text-secondary", background, 4.5] as const,
    ["--color-link", background, 4.5] as const,
    ["--color-error", background, 4.5] as const,
    ["--color-border-strong", background, 3] as const,
    ["--color-focus", background, 3] as const,
  ]),
  ["--color-text", "--color-accent-subtle", 4.5],
  ["--color-on-accent", "--color-accent", 4.5],
  ["--color-on-accent", "--color-accent-hover", 4.5],
  ["--color-on-danger", "--color-danger", 4.5],
  ["--color-on-danger", "--color-danger-hover", 4.5],
  ...STATUSES.flatMap((status) => [
    [`--color-${status}`, `--color-${status}-bg`, 4.5] as const,
    [`--color-${status}`, "--color-bg", 4.5] as const,
    ["--color-text", `--color-${status}-bg`, 4.5] as const,
  ]),
];

function failures(tokens: Map<string, string>): string[] {
  return PAIRS.flatMap(([foreground, background, minimum]) => {
    const ratio = contrast(tokens.get(foreground)!, tokens.get(background)!);
    return ratio >= minimum ? [] : [`${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`];
  });
}

describe("design token contrast", () => {
  const { light, dark } = themeTokens(globals);

  it.each([
    ["light", light],
    ["dark", dark],
  ])("meets the contrast minimums in the %s theme", (_theme, tokens) => {
    expect(failures(tokens)).toEqual([]);
  });

  it("fails when a token drops below its minimum", () => {
    const darkened = new Map(light).set("--color-text-secondary", "#b0b0b0");
    expect(failures(darkened)).toContainEqual(expect.stringContaining("--color-text-secondary on --color-bg"));
  });
});
