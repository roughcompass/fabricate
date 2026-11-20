import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { INSPECTOR_BUNDLE, buildInspector } from "../../scripts/build-inspector";
import { INSPECTOR_MESSAGE, INSPECTOR_SCRIPT } from "../../src/components/toolbar/inspector/protocol";

/*
 * The frame agent's committed bundle (add-applications, design decision 6;
 * restore-toolbar-tools-and-branch-previews, design decision 6) is what its
 * sources build to now, so a change to them, or to web-vitals or esbuild,
 * can't ship without it.
 */

describe("the frame agent's bundle", () => {
  it("matches its sources; run `npm run build:inspector` when it doesn't", async () => {
    expect(fs.readFileSync(INSPECTOR_BUNDLE, "utf8") === (await buildInspector())).toBe(true);
  });

  it("is served where the toolbar loads it from, and tags its messages", () => {
    expect(INSPECTOR_BUNDLE.endsWith(`public${INSPECTOR_SCRIPT}`)).toBe(true);
    expect(fs.readFileSync(INSPECTOR_BUNDLE, "utf8")).toContain(INSPECTOR_MESSAGE);
  });
});
