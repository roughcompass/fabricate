import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCss } from "../support/css";

const COMPONENTS = path.resolve("src/components/ui");

// docs/design-system.md stays the complete reference for the design system.
const doc = fs.readFileSync(path.resolve("docs/design-system.md"), "utf8");
const globals = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");

describe("design system documentation", () => {
  it("documents every token family", () => {
    const tokens = scanCss(globals).filter((declaration) => declaration.context[0] === "@layer tokens" && declaration.property.startsWith("--"));
    // A family is the type prefix: --color-, --font-size-, --space-, and so on.
    const families = new Set(
      tokens
        .map((token) => /^--(font-family|font-size|font-weight|line-height|letter-spacing|color|space|size|radius|shadow|z|duration|ease)-/.exec(token.property)?.[0])
        .filter((family): family is string => Boolean(family)),
    );
    expect(families.size).toBeGreaterThan(10);
    expect([...families].filter((family) => !doc.includes(`\`${family}*\``))).toEqual([]);
  });

  it("documents every component file", () => {
    const files = fs.readdirSync(COMPONENTS).filter((file) => /\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(15);
    expect(files.filter((file) => !doc.includes(`\`${file}\``))).toEqual([]);
  });
});
