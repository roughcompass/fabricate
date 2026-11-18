import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The portal shells' palettes meet WCAG contrast in both themes (portal-runtime
 * spec: shell palettes are restrained in light and dark). The pairs below are
 * every text and control combination the runtime's own chrome draws.
 */

const source = fs.readFileSync(path.resolve("src/demo/runtime/tokens.css"), "utf8");

type Theme = "light" | "dark";
type Palette = Record<string, { light: string; dark: string }>;

function block(selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No block for ${selector}`);
  return source.slice(start, source.indexOf("}", start));
}

function palette(selector: string): Palette {
  const colors: Palette = {};
  for (const [, name, value] of block(selector).matchAll(/(--rt-color-[\w-]+):\s*([^;]+);/g)) {
    const pair = /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/i.exec(value!.trim());
    const single = /^#[0-9a-f]{6}$/i.exec(value!.trim());
    if (pair) colors[name!] = { light: pair[1]!, dark: pair[2]! };
    else if (single) colors[name!] = { light: single[0], dark: single[0] };
  }
  return colors;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const base = palette("[data-demo-portal]");
const SHELLS = {
  access: { ...base, ...palette('[data-demo-portal][data-shell="access"]') },
  markets: { ...base, ...palette('[data-demo-portal][data-shell="markets"]') },
};

const TEXT = 4.5;
const CONTROL = 3;

// [foreground, background, minimum ratio]
const SHARED: [string, string, number][] = [
  ["text", "surface", TEXT],
  ["text", "panel", TEXT],
  ["text", "highlight", TEXT],
  ["muted", "surface", TEXT],
  ["muted", "panel", TEXT],
  ["muted", "highlight", TEXT],
  ["on-header", "header", TEXT],
  ["on-header-muted", "header", TEXT],
  ["on-header", "highlight", TEXT],
  ["accent", "panel", TEXT],
  ["accent", "surface", TEXT],
  ["on-accent", "accent", TEXT],
  ["positive", "panel", TEXT],
  ["negative", "panel", TEXT],
  ["field-border", "panel", CONTROL],
  ["accent", "header", CONTROL],
  ["accent", "highlight", CONTROL],
];

const MARKETS_ONLY: [string, string, number][] = [
  ["on-header", "subbar", TEXT],
  ["on-header-muted", "subbar", TEXT],
  ["accent", "subbar", CONTROL],
  ["on-band", "band", TEXT],
  ["on-band-muted", "band", TEXT],
];

describe("portal shell palettes", () => {
  for (const [shell, colors] of Object.entries(SHELLS)) {
    for (const theme of ["light", "dark"] as Theme[]) {
      it(`meets contrast for every ${shell} pair in the ${theme} theme`, () => {
        const pairs = shell === "markets" ? [...SHARED, ...MARKETS_ONLY] : SHARED;
        const failing = pairs
          .map(([foreground, background, minimum]) => {
            const fg = colors[`--rt-color-${foreground}`]?.[theme];
            const bg = colors[`--rt-color-${background}`]?.[theme];
            expect(fg, foreground).toBeDefined();
            expect(bg, background).toBeDefined();
            const ratio = contrast(fg!, bg!);
            return ratio >= minimum ? null : `${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`;
          })
          .filter(Boolean);
        expect(failing).toEqual([]);
      });
    }
  }

  it("uses near-black bars and a deep blue title band in the dark Markets theme", () => {
    const markets = SHELLS.markets;
    expect(luminance(markets["--rt-color-header"]!.dark)).toBeLessThan(0.01);
    const band = markets["--rt-color-band"]!.dark;
    const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(band.slice(index, index + 2), 16));
    expect(b!).toBeGreaterThan(r! + 40);
    expect(b!).toBeGreaterThan(g!);
  });

  it("keeps surfaces neutral: one accent per shell, and no saturated surface, text, or border", () => {
    for (const colors of Object.values(SHELLS)) {
      for (const name of ["surface", "panel", "header", "text", "muted", "border"]) {
        for (const theme of ["light", "dark"] as Theme[]) {
          const hex = colors[`--rt-color-${name}`]![theme];
          const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
          expect(Math.max(...channels) - Math.min(...channels), `${name} ${theme} ${hex}`).toBeLessThanOrEqual(16);
        }
      }
    }
  });
});
