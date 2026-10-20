import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { LOGO_SRC, LOGO_SVG } from "@/prototypes/runtime/shell/logo";

// prototypes/page-shell spec, "The header carries the logo": the page shell's inlined logo is the public logo files' markup.

describe("the page shell's logo", () => {
  it("matches public/brand/jpmorgan-logo.svg and jpmorgan-logo-dark.svg", () => {
    expect(LOGO_SVG.light).toBe(fs.readFileSync("public/brand/jpmorgan-logo.svg", "utf8").trim());
    expect(LOGO_SVG.dark).toBe(fs.readFileSync("public/brand/jpmorgan-logo-dark.svg", "utf8").trim());
  });

  it("is a data URL, which a prototype's frame may load", () => {
    for (const src of Object.values(LOGO_SRC)) expect(src).toMatch(/^data:image\/svg\+xml;charset=UTF-8,%3Csvg/);
  });
});
