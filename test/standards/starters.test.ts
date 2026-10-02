import type { JsonObject } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStandard as createStandardAction } from "@/app/(operator)/standards/actions";
import { type Db, setDb } from "@/lib/db/client";
import { type ReleaseInput, type TargetInput, evaluateReleaseControls } from "@/lib/evaluations/controls";
import { publishDraft } from "@/lib/standards/publish";
import { draftDocument, draftOf, listStandards } from "@/lib/standards/standard-records";
import { STARTERS, findStarter } from "@/lib/standards/starters";
import { validateStandard } from "@/lib/standards/validate";
import { createTestDb } from "../support/db";
import { redirectOf } from "../support/next";
import { manifest, memoryProfile } from "../support/profiles";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

// standard-library: a Salt adherence starter Standard is available.

const salt = findStarter("salt-adherence")!;

describe("starter Standards", () => {
  it.each(STARTERS.map((starter) => [starter.id, starter] as const))("%s passes validation as provided", (_id, starter) => {
    expect(validateStandard(starter.document)).toEqual([]);
  });

  it("declares Profile version 2, and applies every Salt Control only to repositories that use Salt", () => {
    expect(salt.document.input_schemas).toEqual({ repository_profile: [2], relationship_map: [1] });
    const controls = salt.document.controls as JsonObject[];
    expect(controls.map((control) => control.key)).toEqual([
      "salt-theme-stylesheet",
      "salt-provider",
      "salt-internal-selectors",
      "salt-unknown-tokens",
      "salt-adoption",
      "salt-token-share",
      "salt-token-redefinitions",
      "salt-customization",
      "salt-global-element-rules",
      "salt-important",
    ]);
    for (const control of controls) expect(control.applicability, String(control.key)).toEqual({ op: "contains", selector: "repository.design_systems", mode: "any", values: ["salt"] });
  });

  it("finds starters by exact id only", () => {
    expect(findStarter("salt-adherence")).toBe(salt);
    for (const id of ["SALT-ADHERENCE", "salt", "", null, undefined, "__proto__"]) expect(findStarter(id)).toBeUndefined();
  });

  it("finds every starter Control Not applicable for a repository that doesn't use Salt", async () => {
    const { document } = await memoryProfile({ "package.json": manifest({ name: "plain", dependencies: { react: "18.3.1" } }), "src/App.tsx": "export const App = () => <button>Go</button>;\n" }, { public_id: "src_plain", name: "plain" });
    const target: TargetInput = { public_id: "tgt_plain", source: { public_id: "src_plain", name: "plain" }, state: "complete", failure: null, profile: { public_id: "prf_plain", digest: "0".repeat(64), commit: String(document.commit), factDocument: document.fact_document as JsonObject } };
    const release: ReleaseInput = { public_id: "rel_salt", digest: "1".repeat(64), version: 1, standard: salt.name, document: salt.document };
    const findings = evaluateReleaseControls(release, { targets: [target], map: null });
    expect(findings).toHaveLength(10);
    expect(new Set(findings.map((finding) => finding.outcome))).toEqual(new Set(["not_applicable"]));
  });
});

describe("starting a Standard from a starter", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    setDb(db);
  });
  afterEach(() => setDb(undefined));

  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.append(name, value);
    return data;
  };
  const blank = { values: { name: "", purpose: "" }, errors: {} };

  it("creates a Standard whose draft holds the starter's Controls, ready to publish", async () => {
    const location = await redirectOf(createStandardAction(blank, form({ name: salt.name, purpose: salt.purpose, starter: salt.id })));
    const [standard] = listStandards(db);
    expect(location).toBe(`/standards/${standard!.publicId}/draft?notice=created`);
    expect(standard).toMatchObject({ name: "Salt adherence", purpose: salt.purpose });
    const draft = draftOf(db, standard!.id)!;
    expect(draftDocument(draft)).toEqual(salt.document);
    expect(validateStandard(draftDocument(draft))).toEqual([]);
    const release = publishDraft(db, standard!.publicId, draft.lockVersion);
    expect(release.profileSchemaVersions).toBe("[2]");
  });

  it("starts blank without a starter, or with one it doesn't know", async () => {
    await redirectOf(createStandardAction(blank, form({ name: "Blank", purpose: "No starter" })));
    await redirectOf(createStandardAction(blank, form({ name: "Unknown", purpose: "Unknown starter", starter: "not-a-starter" })));
    for (const standard of listStandards(db)) expect(draftDocument(draftOf(db, standard.id)!).controls).toEqual([]);
  });
});
