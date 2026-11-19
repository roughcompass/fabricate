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

  it("documents every page template, in the order the gallery shows them", () => {
    const files = fs.readdirSync(path.resolve("src/components/templates")).filter((file) => file.endsWith("-template.tsx"));
    expect(files).toHaveLength(10);
    expect(files.filter((file) => !doc.includes(`\`${file}\``))).toEqual([]);
    const gallery = fs.readFileSync(path.resolve("src/app/(operator)/design-system/specimens/templates.tsx"), "utf8");
    const shown = [...gallery.matchAll(/\["template-[a-z]+", "(\w+) template"\]/g)].map((match) => match[1]);
    const documented = [...doc.slice(doc.indexOf("### Page templates")).matchAll(/^\| (\w+) \| `[a-z]+-template\.tsx` \|/gm)].map((match) => match[1]);
    expect(shown).toHaveLength(10);
    expect(documented).toEqual(shown);
  });
});
