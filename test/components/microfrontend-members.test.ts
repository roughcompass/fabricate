// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { dynamicImportFailure, reportComposition } from "@/components/toolbar/inspector/agent-composition";
import type { InspectedComposition } from "@/components/toolbar/inspector/protocol";
import { membersOf } from "@/components/toolbar/microfrontends/members";

/*
 * What Microfrontends says a remote entry the page requested did
 * (template-demo/microfrontends spec, "Each microfrontend shows its address
 * and state"). Found in the seeded fleet check (restore-toolbar-tools-and-
 * branch-previews, task 12.3): fleet/mf-shell loads mfBilling with import()
 * from an address where nothing listens, and the panel said Loaded. A failed
 * import() leaves no element and a status of 0, as a script tag's successful
 * load does, so the agent reads the failure from the import's rejection.
 */

const BILLING = "http://127.0.0.1:9102/assets/remoteEntry.js";
const EMPTY: InspectedComposition = { federation: [], containers: [], requests: [], failed: [], importMaps: [], regions: [] };

describe("a remote entry loaded with import()", () => {
  it("reads the address from a failed import's error, as Chrome and Firefox word it", () => {
    expect(dynamicImportFailure(new TypeError(`Failed to fetch dynamically imported module: ${BILLING}`))).toBe(BILLING);
    expect(dynamicImportFailure(new TypeError(`error loading dynamically imported module: ${BILLING}`))).toBe(BILLING);
    expect(dynamicImportFailure(new Error("Something else went wrong"))).toBeNull();
    expect(dynamicImportFailure(undefined)).toBeNull();
  });

  it("reports the address as failed when the page leaves the rejection unhandled", async () => {
    const posted: InspectedComposition[] = [];
    reportComposition((message) => {
      if (message.kind === "composition") posted.push(message.composition);
    });
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new TypeError(`Failed to fetch dynamically imported module: ${BILLING}`) }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(posted.at(-1)?.failed).toContain(BILLING);
  });

  it("shows a found entry whose import failed as Failed to load, and one that loaded, or a script tag's, as Loaded", () => {
    const requests = [{ url: BILLING, initiator: "script", status: 0 }];
    expect(membersOf([], { ...EMPTY, requests }, [])).toMatchObject([{ mechanism: "found", entry: BILLING, state: "loaded" }]);
    expect(membersOf([], { ...EMPTY, requests, failed: [BILLING] }, [])).toMatchObject([{ mechanism: "found", entry: BILLING, state: "failed" }]);
  });
});
