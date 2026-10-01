import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { setDb } from "@/lib/db/client";
import { createTestDb } from "../support/db";

// operator-interface/page-patterns spec: a share link that no longer resolves
// opens a not-found page with a way back; while the demo is disabled it is a
// plain 404 (template-demo/demo-mode spec).
describe("share link route", () => {
  const original = getConfig();
  beforeEach(() => setDb(createTestDb()));
  afterEach(() => {
    setDb(undefined);
    setConfig(original);
  });

  const open = async (token: string) => {
    const { GET } = await import("@/app/s/[token]/route");
    return GET(new Request(`http://localhost/s/${token}`), { params: Promise.resolve({ token }) });
  };

  it("sends an unknown token to the running application's not-found page while the demo is enabled", async () => {
    setConfig(withOverrides(original, { demo: { enabled: true } }));
    const response = await open("A".repeat(43));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/run/unavailable");
  });

  it("answers a plain 404 while the demo is disabled", async () => {
    setConfig(withOverrides(original, { demo: { enabled: false } }));
    const response = await open("A".repeat(43));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
