import type { JsonObject } from "@repo-facts/contract";
import { describe, expect, it, vi } from "vitest";
import { createStandard as createStandardAction } from "@/app/(operator)/standards/actions";
import { type ReleaseInput, type TargetInput, evaluateReleaseControls } from "@/lib/evaluations/controls";
import { publishDraft } from "@/lib/standards/publish";
import { draftDocument, draftOf, listStandards } from "@/lib/standards/standard-records";
import { STARTERS, findStarter } from "@/lib/standards/starters";
import { validateStandard } from "@/lib/standards/validate";
import { redirectOf, useAppDb, formData } from "../support/next";
import { manifest, memoryProfile } from "../support/profiles";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

// standard-library: the Salt adherence and Salt exemplary starter Standards.

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

describe("the Salt exemplary starter", () => {
  const exemplary = findStarter("salt-exemplary")!;
  const SALT_APP = {
    "package.json": manifest({ name: "queue", dependencies: { react: "19.3.0", "@salt-ds/core": "1.75.0", "@salt-ds/theme": "1.48.0" } }),
    "src/main.tsx": 'import "@salt-ds/theme/index.css";\nimport { SaltProvider } from "@salt-ds/core";\nimport { createRoot } from "react-dom/client";\nimport { App } from "./App";\ncreateRoot(document.getElementById("root")!).render(<SaltProvider><App /></SaltProvider>);\n',
  };
  const evaluate = async (app: string) => {
    const { document } = await memoryProfile({ ...SALT_APP, "src/App.tsx": app }, { public_id: "src_queue", name: "queue" });
    const target: TargetInput = { public_id: "tgt_queue", source: { public_id: "src_queue", name: "queue" }, state: "complete", failure: null, profile: { public_id: "prf_queue", digest: "0".repeat(64), commit: String(document.commit), factDocument: document.fact_document as JsonObject } };
    const release: ReleaseInput = { public_id: "rel_exemplary", digest: "2".repeat(64), version: 1, standard: exemplary.name, document: exemplary.document };
    return evaluateReleaseControls(release, { targets: [target], map: null });
  };
  const outcomes = (findings: Awaited<ReturnType<typeof evaluate>>) => Object.fromEntries(findings.map((finding) => [(finding.control as { key: string }).key, finding.outcome]));

  it("declares Profile version 2, applies only to Salt, and sets no customized-share limit", () => {
    expect(exemplary.document.input_schemas).toEqual({ repository_profile: [2], relationship_map: [1] });
    const controls = exemplary.document.controls as JsonObject[];
    for (const control of controls) expect(control.applicability, String(control.key)).toEqual({ op: "contains", selector: "repository.design_systems", mode: "any", values: ["salt"] });
    expect(JSON.stringify(controls)).not.toContain("customized_share");
  });

  it("finds every Control Meets for token-only inline styles (Token-only inline style)", async () => {
    const findings = await evaluate('import { Button, StackLayout, Text } from "@salt-ds/core";\nexport const App = () => (\n  <StackLayout style={{ padding: "var(--salt-spacing-300)" }}>\n    <Text>Payments</Text>\n    <Button>Approve</Button>\n  </StackLayout>\n);\n');
    expect(outcomes(findings)).toEqual(Object.fromEntries((exemplary.document.controls as JsonObject[]).map((control) => [control.key, "meets"])));
  });

  it("finds Gaps for adoption and raw elements for one raw button, citing it (One raw button)", async () => {
    const findings = await evaluate('import { StackLayout, Text } from "@salt-ds/core";\nexport const App = () => (\n  <StackLayout>\n    <Text>Payments</Text>\n    <button>Approve</button>\n  </StackLayout>\n);\n');
    const gaps = findings.filter((finding) => finding.outcome === "gap").map((finding) => (finding.control as { key: string }).key).sort();
    expect(gaps).toEqual(["salt-exemplary-adoption", "salt-exemplary-raw-equivalents"]);
  });

  it("finds every Control Not applicable for a repository that doesn't use Salt (Starter Controls outside Salt)", async () => {
    const { document } = await memoryProfile({ "package.json": manifest({ name: "plain", dependencies: { react: "18.3.1" } }), "src/App.tsx": "export const App = () => <button>Go</button>;\n" }, { public_id: "src_plain", name: "plain" });
    const target: TargetInput = { public_id: "tgt_plain", source: { public_id: "src_plain", name: "plain" }, state: "complete", failure: null, profile: { public_id: "prf_plain", digest: "0".repeat(64), commit: String(document.commit), factDocument: document.fact_document as JsonObject } };
    const findings = evaluateReleaseControls({ public_id: "rel_exemplary", digest: "2".repeat(64), version: 1, standard: exemplary.name, document: exemplary.document }, { targets: [target], map: null });
    expect(new Set(findings.map((finding) => finding.outcome))).toEqual(new Set(["not_applicable"]));
  });
});

describe("starting a Standard from a starter", () => {
  const app = useAppDb();
  const blank = { values: { name: "", purpose: "" }, errors: {} };

  it("creates a Standard whose draft holds the starter's Controls, ready to publish", async () => {
    const location = await redirectOf(createStandardAction(blank, formData({ name: salt.name, purpose: salt.purpose, starter: salt.id })));
    const [standard] = listStandards(app.db);
    expect(location).toBe(`/standards/${standard!.publicId}/draft?notice=created`);
    expect(standard).toMatchObject({ name: "Salt adherence", purpose: salt.purpose });
    const draft = draftOf(app.db, standard!.id)!;
    expect(draftDocument(draft)).toEqual(salt.document);
    expect(validateStandard(draftDocument(draft))).toEqual([]);
    const release = publishDraft(app.db, standard!.publicId, draft.lockVersion);
    expect(release.profileSchemaVersions).toEqual([2]);
  });

  it("starts blank without a starter, or with one it doesn't know", async () => {
    await redirectOf(createStandardAction(blank, formData({ name: "Blank", purpose: "No starter" })));
    await redirectOf(createStandardAction(blank, formData({ name: "Unknown", purpose: "Unknown starter", starter: "not-a-starter" })));
    for (const standard of listStandards(app.db)) expect(draftDocument(draftOf(app.db, standard.id)!).controls).toEqual([]);
  });
});
