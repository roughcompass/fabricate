import crypto from "node:crypto";
import type { JsonObject } from "@repo-facts/contract";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitiative } from "@/app/initiatives/actions";
import type { InitiativeFormState } from "@/app/initiatives/form-state";
import { createStandard, publishStandard, reviseStandard, saveDraft } from "@/app/standards/actions";
import { ControlList } from "@/app/standards/control-view";
import type { DraftSaveState } from "@/app/standards/form-state";
import { type Db, setDb } from "@/lib/db/client";
import { findingDocument, findingsOf, getEvaluation } from "@/lib/evaluations/evaluation-records";
import { startEvaluation } from "@/lib/evaluations/start";
import { getInitiative, listInitiatives, selectedReleases } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { draftOf, getStandard, listStandards, releaseDocument, releasesOf } from "@/lib/standards/standard-records";
import { buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { redirectOf } from "../support/next";
import { manifest } from "../support/profiles";
import { seedAssessment } from "../support/scenarios";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

/**
 * A Standard through its whole lifecycle, driven by the Server Actions the
 * structured editor uses: creation, a draft with every problem reported at
 * once, publication, selection by an Initiative, Service Dependency Controls
 * evaluated against an Assessment, and revision. Control text that looks like
 * markup, code, or a prototype key stays inert data everywhere it goes.
 */

const TRAP = "__fabricateControlTrap";
const HOSTILE = {
  title: `<img src=x onerror="globalThis.${TRAP}=1">Service destinations are configurable`,
  rationale: "${globalThis." + TRAP + "=1} `" + "${process.exit(1)}` {{constructor.constructor('return process')()}}",
  guidance: `<script>globalThis.${TRAP}=1</script> javascript:globalThis.${TRAP}=1`,
};

const form = (fields: Record<string, string | number | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) data.append(name, String(item));
  return data;
};
const draftState = (lockVersion: number): DraftSaveState => ({ lockVersion, issues: [], status: "unsaved", message: null, submission: 0 });
const standardDocument = (controls: unknown[]) => ({ schema: "fabricate.standard", schema_version: 1, input_schemas: { repository_profile: [1], relationship_map: [1] }, controls });

const servicesControl = {
  key: "services-configurable",
  title: HOSTILE.title,
  rationale: HOSTILE.rationale,
  severity: "critical",
  subject: "repository",
  applicability: { op: "some", collection: "service_dependencies", condition: { op: "always" } },
  condition: {
    op: "every",
    collection: "service_dependencies",
    where: { op: "in", selector: "service.protocol", values: ["http"] },
    condition: { op: "any", items: [{ op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided"] }, { op: "equals", selector: "service.has_contract", value: true }] },
  },
  guidance: HOSTILE.guidance,
};
// A prototype key as a free-text parameter reads as an absent package, never as the object prototype.
const prototypeControl = {
  key: "no-prototype-package",
  title: "Declares no package named __proto__",
  rationale: "Parameters are data.",
  severity: "info",
  subject: "repository",
  applicability: { op: "always" },
  condition: { op: "not", item: { op: "exists", selector: "repository.declared_range", parameter: "__proto__" } },
  guidance: null,
};
const contractControl = {
  key: "contracts-committed",
  title: "Every service has a committed contract",
  rationale: "Offline work needs the boundary in writing.",
  severity: "high",
  subject: "repository",
  applicability: { op: "always" },
  condition: { op: "count", collection: "service_dependencies", where: { op: "equals", selector: "service.has_contract", value: false }, comparator: "eq", value: 0 },
  guidance: null,
};

describe("Standard lifecycle", () => {
  let db: Db;
  let standardId: string;

  beforeAll(() => {
    db = createTestDb();
    setDb(db);
  });
  afterAll(() => {
    setDb(undefined);
    delete (globalThis as Record<string, unknown>)[TRAP];
  });

  const draft = () => draftOf(db, getStandard(db, standardId).id)!;
  const save = (document: unknown) => saveDraft(standardId, draftState(draft().lockVersion), form({ lockVersion: draft().lockVersion, document: JSON.stringify(document) }));

  it("creates a Standard with an empty draft", async () => {
    const location = await redirectOf(createStandard({ values: { name: "", purpose: "" }, errors: {} }, form({ name: "Service readiness", purpose: "Can each repository be worked on offline?" })));
    standardId = listStandards(db)[0]!.publicId;
    expect(location).toBe(`/standards/${standardId}/draft?notice=created`);
    expect(draft()).toBeDefined();
  });

  it("saves an invalid draft and reports every problem at once, and refuses to publish it", async () => {
    const broken = standardDocument([
      { ...contractControl, key: "Not A Key", severity: "urgent" },
      { ...servicesControl, condition: { op: "every", collection: "service_dependencies", condition: { op: "equals", selector: "service.nonexistent", value: 1 } } },
      { ...contractControl, applicability: { op: "evaluate", code: "process.exit(1)" } },
      { ...contractControl, key: "services-configurable", __proto__: { polluted: true } },
      { ...servicesControl, key: "prototype-values", condition: { op: "every", collection: "service_dependencies", where: { op: "in", selector: "service.protocol", values: ["__proto__", "constructor"] }, condition: { op: "always" } } },
    ]);
    const result = await save(broken);
    expect(result.status).toBe("saved");
    const messages = result.issues.map((issue) => `${issue.field}: ${issue.message}`);
    expect(messages.length).toBeGreaterThanOrEqual(5);
    for (const fragment of ["key", "severity", "service.nonexistent", "evaluate", "services-configurable", '"__proto__" is not an allowed protocol', '"constructor" is not an allowed protocol']) expect(messages.join("\n"), fragment).toContain(fragment);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    expect(await redirectOf(publishStandard(standardId, form({ lockVersion: draft().lockVersion })))).toBe(`/standards/${standardId}/publish?notice=invalid`);
    expect(releasesOf(db, getStandard(db, standardId).id)).toEqual([]);
  });

  it("publishes a valid draft with Service Dependency Controls as an immutable Release", async () => {
    const result = await save(standardDocument([servicesControl, contractControl, prototypeControl]));
    expect(result).toMatchObject({ status: "saved", issues: [] });

    const location = await redirectOf(publishStandard(standardId, form({ lockVersion: draft().lockVersion })));
    const [v1] = releasesOf(db, getStandard(db, standardId).id);
    expect(location).toBe(`/standards/${standardId}/releases/${v1!.publicId}?notice=published`);
    expect(v1!.version).toBe(1);
    // The canonical Release orders Controls by key and keeps their text exactly as written.
    const controls = releaseDocument(v1!).controls as JsonObject[];
    expect(controls.map((control) => control.key)).toEqual(["contracts-committed", "no-prototype-package", "services-configurable"]);
    expect(controls[2]).toMatchObject({ title: HOSTILE.title, rationale: HOSTILE.rationale, guidance: HOSTILE.guidance });
    expect(draftOf(db, getStandard(db, standardId).id)).toBeUndefined();

    // Published data cannot change: the database refuses, and there is no draft left to save.
    expect(() => rawRun(db, "update standard_releases set document = ? where id = ?", "{}", v1!.id)).toThrow(/immutable/);
    expect(() => rawRun(db, "delete from standard_releases where id = ?", v1!.id)).toThrow(/retained/);
    expect(await redirectOf(saveDraft(standardId, draftState(1), form({ lockVersion: 1, document: JSON.stringify(standardDocument([])) })))).toBe(`/standards/${standardId}?notice=no_draft`);
  });

  it("is selected by an Initiative and evaluated against an Assessment without running any Control content", async () => {
    const [v1] = releasesOf(db, getStandard(db, standardId).id);
    const storefront = buildSource(db, { name: "storefront" });
    const blank: InitiativeFormState = { values: { name: "", objective: "", selectionMode: "all_enabled", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} };
    await redirectOf(createInitiative(blank, form({ name: "Offline readiness", objective: "Work without live services", selectionMode: "explicit", sourcePublicIds: [storefront.publicId], standardReleasePublicIds: [v1!.publicId] })));
    const initiative = listInitiatives(db)[0]!;
    expect(selectedReleases(db, initiative.id).map(({ release }) => release.publicId)).toEqual([v1!.publicId]);

    const assessment = await seedAssessment(db, getInitiative(db, initiative.publicId), [storefront], [
      {
        "package.json": manifest({ name: "storefront", version: "1.0.0" }),
        "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" }).then((res) => res.json()).then((body) => body.status);\n',
        "src/orders.ts": "export const orders = () => fetch(`${process.env.ORDERS_URL}/orders`).then((res) => res.json()).then((body) => body.orders);\n",
      },
    ]);
    const { evaluation } = startEvaluation(db, initiative.publicId, assessment.publicId, crypto.randomUUID());
    await drainJobs(db, jobHandlers(db));
    expect(getEvaluation(db, evaluation.publicId).state).toBe("complete");

    const findings = Object.fromEntries(findingsOf(db, evaluation.id).map((finding) => [finding.controlKey, findingDocument(finding)]));
    // One literal, uncontracted destination makes "every" a Gap; the count of uncontracted services is two.
    expect(findings["services-configurable"]).toMatchObject({ outcome: "gap", control: { title: HOSTILE.title, rationale: HOSTILE.rationale }, guidance: { text: HOSTILE.guidance, kind: "diagnostic" } });
    expect(findings["contracts-committed"]).toMatchObject({ outcome: "gap" });
    expect(findings["no-prototype-package"]).toMatchObject({ outcome: "meets" });
    expect((globalThis as Record<string, unknown>)[TRAP]).toBeUndefined();
  });

  it("renders Control text as text, never as markup", () => {
    const [v1] = releasesOf(db, getStandard(db, standardId).id);
    const html = renderToStaticMarkup(ControlList({ controls: releaseDocument(v1!).controls ?? [] }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toContain("&lt;script&gt;");
    expect((globalThis as Record<string, unknown>)[TRAP]).toBeUndefined();
  });

  it("revises a Release into a new version without changing the one an Initiative selected", async () => {
    const [v1] = releasesOf(db, getStandard(db, standardId).id);
    const published = { digest: v1!.digest, document: v1!.document };
    expect(await redirectOf(reviseStandard(standardId, v1!.publicId))).toBe(`/standards/${standardId}/draft?notice=revision`);
    expect((await save(standardDocument([contractControl]))).issues).toEqual([]);
    await redirectOf(publishStandard(standardId, form({ lockVersion: draft().lockVersion })));

    const [v2, original] = releasesOf(db, getStandard(db, standardId).id);
    expect([v2!.version, original!.version]).toEqual([2, 1]);
    expect({ digest: original!.digest, document: original!.document }).toEqual(published);
    expect(releaseDocument(v2!).controls).toHaveLength(1);
    // The Initiative keeps the Release it selected until someone changes the selection.
    expect(selectedReleases(db, listInitiatives(db)[0]!.id).map(({ release }) => release.version)).toEqual([1]);
  });
});
