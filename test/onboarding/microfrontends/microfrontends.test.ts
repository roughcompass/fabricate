import { beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { StaleRecordError, ValidationError } from "@/lib/db/errors";
import { applicationRevisionView, getApplication, readApplicationDraft, renderingCompatibility, saveApplicationDraft, startApplicationDraft } from "@/lib/onboarding/applications";
import { recordRead } from "@/lib/onboarding/external/evidence";
import { referenceOf } from "@/lib/onboarding/external/references";
import { BlockedError } from "@/lib/onboarding/issues";
import {
  assetAccess,
  createMicrofrontend,
  findAssets,
  findMicrofrontend,
  getMicrofrontend,
  microfrontendDraftSchema,
  microfrontendHistory,
  microfrontendReadiness,
  microfrontendUses,
  normalizeWorkspacePath,
  readMicrofrontendDraft,
  registerAssetFor,
  retireMicrofrontend,
  saveMicrofrontendDraft,
  startMicrofrontendDraft,
  submitMicrofrontend,
} from "@/lib/onboarding/microfrontends";
import { draftOf, latestSubmitted, latestValidation, revisionsOf } from "@/lib/onboarding/revisions";
import { buildSource } from "../../support/builders";
import { createTestDb, rawRun } from "../../support/db";
import { CHILD_RENDERING, MFE_RENDERING, ana, cdaasView, cy, observeCdaas, observeStudio, onboardApplication, registerMfe } from "../../support/onboarding";
import { migratedV1Database } from "../../support/onboarding-v1";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 3, hour, 0));

describe("MFE assets", () => {
  let db: Db;
  let repository: RepositorySource;

  beforeEach(() => {
    db = createTestDb();
    repository = buildSource(db, { name: "payee" });
  });

  /** Creates an MFE and submits a Draft built from +document+, returning the validation result. */
  const attempt = (name: string, document: Record<string, unknown>) => {
    const { microfrontend, draft } = createMicrofrontend(db, { name, ownerTeam: "Payee" }, ana);
    const saved = saveMicrofrontendDraft(db, microfrontend.publicId, { lockVersion: draft.lockVersion, document: microfrontendDraftSchema.parse({ name, ownerTeam: "Payee", repository: repository.publicId, cdaas: { appId: "payee", viewId: name.toLowerCase() }, rendering: MFE_RENDERING, ...document }) });
    return { microfrontend, result: submitMicrofrontend(db, microfrontend.publicId, { lockVersion: saved.lockVersion, actor: ana }) };
  };
  const codes = (result: { issues: { code: string; location: string }[] }) => result.issues.map((issue) => [issue.code, issue.location]);

  describe("identity", () => {
    it("is one reusable identity: several Applications bind it, each with its own role and mount (Shared MFE, MFE has different roles)", () => {
      const search = registerMfe(db, "Payee search", { repository });
      const details = registerMfe(db, "Payee details", { repository: buildSource(db, { name: "payee-details" }), rendering: { iframe: null, esm: null, module_federation_2: { exposes: ["./Details"] } } });
      const managed = onboardApplication(db, "Payments workspace", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App" } }, { candidate: "agreed" }).application;
      const composite = onboardApplication(db, "Payee hub", { launch: { kind: "mfe", microfrontend: details.publicId, mode: "module_federation_2", exposedModule: "./Details" }, children: [{ microfrontend: search.publicId, mountKind: "slot", mountKey: "search", required: true, module: null }] }).application;
      const external = onboardApplication(db, "Payments console", {
        launch: { kind: "external", mode: "esm", moduleUrl: "https://payments.example.com/console.js", exportedModule: "mount" },
        children: [{ microfrontend: search.publicId, mountKind: "route", mountKey: "/search", required: false, module: null }],
      }).application;

      expect(microfrontendUses(db, search.id).map((use) => [use.application.name, use.role, use.mount, use.launchKind])).toEqual([
        ["Payee hub", "child", "Slot search", "mfe"],
        ["Payments console", "child", "Route /search", "external"],
        ["Payments workspace", "entry", null, "mfe"],
      ]);
      expect(db.$client.prepare("select count(*) as n from microfrontends").get()).toEqual({ n: 2 });
      const columns = (db.$client.prepare("pragma table_info(microfrontends)").all() as { name: string }[]).map((column) => column.name);
      expect(columns.filter((name) => /role|entry|host|child/.test(name))).toEqual([]);
      expect(applicationRevisionView(db, external.activeRevisionId!).components.map((row) => row.component.role)).toEqual(["child"]);
      expect(applicationRevisionView(db, managed.activeRevisionId!).components.map((row) => row.component.role)).toEqual(["entry"]);
      expect(applicationRevisionView(db, composite.activeRevisionId!).components.map((row) => [row.microfrontend.name, row.component.role])).toEqual([
        ["Payee details", "entry"],
        ["Payee search", "child"],
      ]);
    });

    it("lets MFEs share a SEAL ID, and keeps its owner its own", () => {
      const search = registerMfe(db, "Payee search", { repository, sealId: "88001", ownerTeam: "Payee" });
      const details = registerMfe(db, "Payee details", { repository: buildSource(db, { name: "details" }), sealId: "88001", ownerTeam: "Payee Details" });
      expect([getMicrofrontend(db, search.publicId).ownerTeam, getMicrofrontend(db, details.publicId).ownerTeam]).toEqual(["Payee", "Payee Details"]);
      expect(() => createMicrofrontend(db, { name: " ", sealId: "x y" }, ana)).toThrow(/Enter the MFE's name/);
    });
  });

  describe("source coordinates", () => {
    it("lets one Repository build several MFEs from distinct workspace paths (Monorepo produces several MFEs)", () => {
      registerMfe(db, "Payee search", { repository, workspacePath: "apps/search" });
      registerMfe(db, "Payee details", { repository, workspacePath: "./apps//details/" });
      expect(db.$client.prepare("select workspace_path as path from microfrontend_revisions order by id").all()).toEqual([{ path: "apps/search" }, { path: "apps/details" }]);
    });

    it("refuses a missing, disabled, duplicate, or traversing source", () => {
      registerMfe(db, "Payee search", { repository, workspacePath: "apps/search" });
      expect(codes(attempt("Missing", { repository: null }).result)).toEqual([["mfe.source_missing", "repository"]]);
      expect(codes(attempt("Unknown", { repository: "src_aaaaaaaaaaaaaaaa" }).result)).toEqual([["mfe.source_unknown", "repository"]]);
      const disabled = buildSource(db, { name: "legacy", enabled: false });
      expect(codes(attempt("Disabled", { repository: disabled.publicId }).result)).toEqual([["mfe.source_disabled", "repository"]]);
      expect(codes(attempt("Duplicate", { workspacePath: "apps/search/" }).result)).toEqual([["mfe.source_duplicate", "workspacePath"]]);
      expect(codes(attempt("Traversal", { workspacePath: "apps/../../etc" }).result)).toEqual([["mfe.workspace_invalid", "workspacePath"]]);
      expect(codes(attempt("Absolute", { workspacePath: "/srv/apps" }).result)).toEqual([["mfe.workspace_invalid", "workspacePath"]]);
      expect(normalizeWorkspacePath("apps\\search")).toEqual({ path: "apps/search", problem: null });
      expect(normalizeWorkspacePath(".")).toEqual({ path: null, problem: null });
      expect(() => rawRun(db, "update microfrontend_revisions set workspace_path = '../x', lock_version = lock_version + 1 where state = 'draft'")).toThrow(/microfrontend_revisions_workspace_path/);
    });

    it("stops being Ready when its Repository is disabled", () => {
      const search = registerMfe(db, "Payee search", { repository });
      expect(getMicrofrontend(db, search.publicId).lifecycle).toBe("ready");
      rawRun(db, "update repository_sources set enabled = 0 where id = ?", repository.id);
      expect(microfrontendReadiness(db, getMicrofrontend(db, search.publicId)).checks.find((check) => check.code === "mfe.source")).toMatchObject({ state: "fail", message: "payee is disabled in the catalog" });
    });
  });

  describe("CDaaS views", () => {
    it("shows the confirmed view with when and where it was observed (Existing CDaaS view is confirmed)", () => {
      const search = registerMfe(db, "Payee search", { repository, cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      expect(getMicrofrontend(db, search.publicId).lifecycle).toBe("draft");
      observeCdaas(db, search, { outcome: "found", projection: cdaasView("payee", "search", 2) }, at(8));
      const readiness = microfrontendReadiness(db, getMicrofrontend(db, search.publicId), at(9));
      expect(readiness.cdaas).toMatchObject({ state: "matching", system: "cdaas", observedAt: at(8), values: [{ label: "appId", expected: "payee", observed: "payee", matches: true }, { label: "viewId", expected: "search", observed: "search", matches: true }] });
      expect(readiness.ready).toBe(true);
    });

    it("refuses a CDaaS pair another MFE holds, merging neither (Pair belongs to another MFE)", () => {
      registerMfe(db, "Payee search", { repository, cdaas: { appId: "payee", viewId: "search" } });
      const { result } = attempt("Payee search v2", { repository: buildSource(db, { name: "payee-v2" }).publicId, cdaas: { appId: "payee", viewId: "search" } });
      expect(codes(result)).toEqual([["mfe.cdaas_conflict", "cdaas"]]);
      expect(result.issues[0]!.message).toBe("The CDaaS view payee/search belongs to the MFE Payee search. One view represents one MFE");
      expect(() => rawRun(db, "update microfrontends set cdaas_app_id = 'payee', cdaas_view_id = 'search' where name = 'Payee search v2'")).toThrow(/UNIQUE constraint failed: microfrontends.cdaas_app_id, microfrontends.cdaas_view_id/);
    });

    it("takes the pair only from what the team states: never from its SEAL ID or a Studio module", () => {
      const { microfrontend, result } = attempt("Payee search", { cdaas: null });
      expect(result).toMatchObject({ submitted: true, issues: [{ code: "mfe.cdaas_missing", severity: "warning" }] });
      observeStudio(db, { kind: "microfrontend", id: microfrontend.id }, "module", "6f1d", { outcome: "found", projection: { uuid: "6f1d", title: "Payee search", appId: "payee", url: null, sealId: "88001", status: "Active", version: 3, typeLabels: ["MFE"] } });
      const mfe = getMicrofrontend(db, microfrontend.publicId);
      expect([mfe.cdaasAppId, mfe.cdaasViewId, referenceOf(db, { kind: "microfrontend", id: mfe.id }, "cdaas", "application_view")]).toEqual([null, null, undefined]);
      expect(microfrontendReadiness(db, mfe).cdaas).toMatchObject({ state: "unknown", reason: "No CDaaS appId and viewId are declared" });
    });

    it("never treats Missing, Conflicting, Unknown, or Stale evidence as confirmed", () => {
      const search = registerMfe(db, "Payee search", { repository, cdaas: { appId: "payee", viewId: "search" }, confirmed: false });
      const state = (now = at(9)) => microfrontendReadiness(db, getMicrofrontend(db, search.publicId), now);
      expect(state()).toMatchObject({ ready: false, cdaas: { state: "unknown", reason: "The CDaaS application view hasn't been read yet" } });

      observeCdaas(db, search, { outcome: "unavailable", error: "CDaaS didn't answer in time" }, at(8));
      expect(state()).toMatchObject({ ready: false, cdaas: { state: "unknown", reason: "The CDaaS application view couldn't be read: CDaaS didn't answer in time" } });

      observeCdaas(db, search, { outcome: "not_found" }, at(8));
      expect(state()).toMatchObject({ ready: false, cdaas: { state: "missing" } });

      observeCdaas(db, search, { outcome: "found", projection: cdaasView("payee", "search-legacy") }, at(8));
      expect(state()).toMatchObject({ ready: false, cdaas: { state: "conflicting", reason: "CDaaS has a different viewId" } });

      observeCdaas(db, search, { outcome: "found", projection: { appId: "payee" } }, at(8));
      expect(state()).toMatchObject({ ready: false, cdaas: { state: "unknown", reason: "The CDaaS application view's response didn't match its contract" } });

      observeCdaas(db, search, { outcome: "found", projection: cdaasView("payee", "search") }, at(8));
      expect(state()).toMatchObject({ ready: true, cdaas: { state: "matching" } });
      expect(state(at(8 + 25))).toMatchObject({ ready: false, cdaas: { state: "stale", reason: "The CDaaS application view hasn't been observed recently" } });
      observeCdaas(db, search, { outcome: "unavailable", error: "HTTP 503" }, at(10));
      expect(state(at(10))).toMatchObject({ ready: false, cdaas: { state: "stale", values: [{ observed: "payee" }, { observed: "search" }] } });

      const reference = referenceOf(db, { kind: "microfrontend", id: search.id }, "cdaas", "application_view")!;
      recordRead(db, reference, { outcome: "found", projection: cdaasView("payee", "search") }, { readAt: at(11), contractDigest: "f".repeat(64) });
      expect(state(at(11))).toMatchObject({ ready: false, cdaas: { state: "unknown", reason: "The CDaaS application view was last read under an earlier contract" } });
      expect(microfrontendHistory(db, search.id).filter((event) => event.event === "ready" || event.event === "not_ready").map((event) => event.event).reverse()).toEqual(["ready", "not_ready"]);
    });

    it("keeps its identity and bindings as CDaaS reports new versions (New build appears)", () => {
      const search = registerMfe(db, "Payee search", { repository, cdaas: { appId: "payee", viewId: "search" } });
      const app = onboardApplication(db, "Payments workspace", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App" } }).application;
      const before = { mfe: getMicrofrontend(db, search.publicId), revisions: revisionsOf(db, "microfrontend", search.id).length, bindings: microfrontendUses(db, search.id) };
      observeCdaas(db, search, { outcome: "found", projection: cdaasView("payee", "search", 5) });
      expect(getMicrofrontend(db, search.publicId)).toEqual({ ...before.mfe });
      expect(revisionsOf(db, "microfrontend", search.id)).toHaveLength(before.revisions);
      expect(microfrontendUses(db, search.id)).toEqual(before.bindings);
      expect(db.$client.prepare("select count(*) as n from external_observations").get()).toEqual({ n: 2 });
      expect(app.lifecycle).toBe("draft");
    });
  });

  describe("rendering metadata", () => {
    it("registers an ESM MFE with its source, CDaaS view, and exported module, and no runtime-contract questionnaire (Register ESM MFE)", () => {
      const { microfrontend, result } = attempt("Search", { rendering: { iframe: null, esm: { exports: [" ./Search ", "./Search", ""] }, module_federation_2: null } });
      expect(result).toMatchObject({ submitted: true, issues: [] });
      const revision = latestSubmitted(db, "microfrontend", microfrontend.id)!;
      expect(revision).toMatchObject({ formatVersion: 2, document: { rendering: { iframe: null, esm: { exports: ["./Search"] }, module_federation_2: null } } });
      expect(JSON.stringify(revision.document)).not.toMatch(/requires|provides|events|context|shared|capabilit/);
      expect(db.$client.prepare("select contract, contract_digest as digest, rendering from microfrontend_revisions where id = ?").get(revision.id)).toEqual({ contract: null, digest: null, rendering: '{"esm":{"exports":["./Search"]},"iframe":null,"module_federation_2":null}' });
      expect(microfrontendReadiness(db, getMicrofrontend(db, microfrontend.publicId)).checks.find((check) => check.code === "mfe.rendering")).toMatchObject({ state: "pass", message: "Loads through ESM module (./Search)" });
    });

    it("needs no email: it names its owning team (MFE needs no email)", () => {
      const search = registerMfe(db, "Payee search", { repository, ownerTeam: "Payee" });
      for (const table of ["microfrontends", "microfrontend_revisions"]) {
        const columns = (db.$client.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
        expect(columns.filter((name) => /email/.test(name)), table).toEqual([]);
      }
      expect(getMicrofrontend(db, search.publicId).ownerTeam).toBe("Payee");
    });

    it("locates every rendering problem, and refuses requires, provides, and shared declarations outside legacy", () => {
      const missing = attempt("Nothing", { rendering: { iframe: null, esm: null, module_federation_2: null } });
      expect(codes(missing.result)).toEqual([["mfe.rendering_missing", "rendering.iframe"]]);
      const invalid = attempt("Invalid", { rendering: { iframe: { entry: "../index.html" }, esm: { exports: [] }, module_federation_2: { exposes: ["has space"] } } });
      expect(codes(invalid.result)).toEqual([
        ["mfe.rendering_invalid", "rendering.esm.exports"],
        ["mfe.rendering_invalid", "rendering.iframe.entry"],
        ["mfe.rendering_invalid", "rendering.module_federation_2.exposes.0"],
      ]);
      const { microfrontend, draft } = createMicrofrontend(db, { name: "Payee search", ownerTeam: "Payee" }, ana);
      expect(() => saveMicrofrontendDraft(db, microfrontend.publicId, { lockVersion: draft.lockVersion, document: { name: "Payee search", contract: { exports: [] } } })).toThrow(ValidationError);
      expect(() => saveMicrofrontendDraft(db, microfrontend.publicId, { lockVersion: draft.lockVersion, document: { name: "Payee search", ownerEmail: "ana@example.com" } })).toThrow(ValidationError);
    });

    it("keeps each revision's canonical rendering metadata, and previews a change against the Applications that bind it", () => {
      const search = registerMfe(db, "Payee search", { repository, rendering: CHILD_RENDERING });
      const host = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "hub" }) });
      onboardApplication(db, "Payee hub", { launch: { kind: "mfe", microfrontend: host.publicId, mode: "module_federation_2", exposedModule: "./App" }, children: [{ microfrontend: search.publicId, mountKind: "slot", mountKey: "search", required: true, module: "./Widget" }] });
      onboardApplication(db, "Payee lite", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "esm", exportedModule: "./Widget" } });

      const drop = { iframe: null, esm: null, module_federation_2: { exposes: ["./Search"] } };
      expect(renderingCompatibility(db, getMicrofrontend(db, search.publicId), drop).map((binding) => [binding.application.name, binding.role, binding.uses, binding.issues.map((issue) => issue.code)])).toEqual([
        ["Payee hub", "child", "slot search, ./Widget", ["composition.module_unknown"]],
        ["Payee lite", "entry", "launch, ESM module ./Widget", ["launch.mode_not_supported"]],
      ]);
      expect(renderingCompatibility(db, getMicrofrontend(db, search.publicId), CHILD_RENDERING).flatMap((binding) => binding.issues)).toEqual([]);

      const draft = startMicrofrontendDraft(db, search.publicId, ana);
      const saved = saveMicrofrontendDraft(db, search.publicId, { lockVersion: draft.lockVersion, document: { ...readMicrofrontendDraft(draft), rendering: { ...CHILD_RENDERING, iframe: { entry: "index.html" } } } });
      expect(submitMicrofrontend(db, search.publicId, { lockVersion: saved.lockVersion, actor: ana })).toMatchObject({ submitted: true, revision: { number: 2 } });
      expect(db.$client.prepare("select number, rendering from microfrontend_revisions where microfrontend_id = ? order by number").all(search.id)).toEqual([
        { number: 1, rendering: '{"esm":{"exports":["./Widget"]},"iframe":null,"module_federation_2":{"exposes":["./Widget"]}}' },
        { number: 2, rendering: '{"esm":{"exports":["./Widget"]},"iframe":{"entry":"index.html"},"module_federation_2":{"exposes":["./Widget"]}}' },
      ]);
      expect(latestValidation(db, "microfrontend", draft.id)!.blocking).toBe(0);
    });
  });

  describe("v1 history", () => {
    it("reads a v1 MFE's rendering from its contract, keeps the contract as history, and asks only where its exports are ambiguous", () => {
      const v1 = migratedV1Database();
      try {
        const named = (name: string) => getMicrofrontend(v1, (v1.$client.prepare("select public_id as id from microfrontends where name = ?").get(name) as { id: string }).id);
        const hub = named("Payee hub");
        expect(microfrontendReadiness(v1, hub)).toMatchObject({ rendering: { iframe: null, esm: null, module_federation_2: { exposes: ["./App"] } } });

        // A new Draft of a v1 MFE carries the unambiguous exports and keeps the contract as history.
        const fromHub = startMicrofrontendDraft(v1, hub.publicId, ana);
        expect(fromHub).toMatchObject({ number: 2, formatVersion: 2, document: { rendering: { module_federation_2: { exposes: ["./App"] } }, legacy: { fromRevision: 1, issues: [], values: { contract: { requires: { events: ["portal.navigate"] } } } } } });
        expect(submitMicrofrontend(v1, hub.publicId, { lockVersion: fromHub.lockVersion, actor: ana })).toMatchObject({ submitted: true, revision: { formatVersion: 2 } });
        expect(latestSubmitted(v1, "microfrontend", hub.id)!.document).not.toHaveProperty("legacy");
        expect(v1.$client.prepare("select format_version as version, contract is not null as contract, rendering is not null as rendering from microfrontend_revisions where microfrontend_id = ? order by number").all(hub.id)).toEqual([
          { version: 1, contract: 1, rendering: 0 },
          { version: 2, contract: 0, rendering: 1 },
        ]);

        // Its open v1 Draft with two framed exports can't be submitted until the team chooses the document.
        const frames = named("Payee frames");
        const draft = draftOf(v1, "microfrontend", frames.id)!;
        const blocked = submitMicrofrontend(v1, frames.publicId, { lockVersion: draft.lockVersion, actor: ana });
        expect(codes(blocked).filter(([code]) => code!.startsWith("migration"))).toEqual([["migration.iframe_entry", "rendering.iframe"]]);
        const chosen = readMicrofrontendDraft(draft);
        const saved = saveMicrofrontendDraft(v1, frames.publicId, { lockVersion: draft.lockVersion, document: { ...chosen, rendering: { ...chosen.rendering, iframe: { entry: "index.html" } }, legacy: { ...chosen.legacy!, issues: [] } } });
        expect(saved.formatVersion).toBe(2);
        expect(codes(submitMicrofrontend(v1, frames.publicId, { lockVersion: saved.lockVersion, actor: ana })).filter(([code]) => code!.startsWith("migration"))).toEqual([]);
      } finally {
        v1.$client.close();
      }
    });
  });

  describe("managed from an Application", () => {
    it("finds shared MFEs by name, team, SEAL ID, or CDaaS view, with how they render and how widely they're used (Team reuses an existing MFE)", () => {
      const search = registerMfe(db, "Payee search", { repository, rendering: CHILD_RENDERING });
      registerMfe(db, "Card controls", { repository: buildSource(db, { name: "cards" }), ownerTeam: "Cards", sealId: "77001", cdaas: { appId: "cards", viewId: "controls" } });
      const retired = registerMfe(db, "Payee legacy", { repository: buildSource(db, { name: "legacy" }) });
      retireMicrofrontend(db, retired.publicId, { lockVersion: getMicrofrontend(db, retired.publicId).lockVersion, reason: "Replaced", actor: cy });
      onboardApplication(db, "Payee lite", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "esm", exportedModule: "./Widget" } });

      expect(findAssets(db, "payee").map((choice) => [choice.microfrontend.name, choice.uses, choice.rendering?.esm?.exports ?? null])).toEqual([["Payee search", 1, ["./Widget"]]]);
      expect(findAssets(db, "cards").map((choice) => choice.microfrontend.name)).toEqual(["Card controls"]);
      expect(findAssets(db, "77001").map((choice) => choice.microfrontend.name)).toEqual(["Card controls"]);
      expect(findAssets(db, "cards/controls").map((choice) => choice.microfrontend.name)).toEqual(["Card controls"]);
      expect(findAssets(db).map((choice) => choice.microfrontend.name)).toEqual(["Card controls", "Payee search"]);
    });

    it("registers a missing MFE as one global identity, which another Application reuses with its history (Team registers a missing MFE)", () => {
      const { application, draft } = (() => {
        const created = onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" } }).application;
        return { application: getApplication(db, created.publicId), draft: startApplicationDraft(db, created.publicId, ana) };
      })();
      const { microfrontend, draft: mfeDraft } = registerAssetFor(db, application, { name: "Payee search" }, ana);
      expect(microfrontend).toMatchObject({ ownerTeam: "Payments", sealId: "88001" });
      const saved = saveMicrofrontendDraft(db, microfrontend.publicId, { lockVersion: mfeDraft.lockVersion, document: microfrontendDraftSchema.parse({ name: "Payee search", ownerTeam: "Payments", repository: repository.publicId, cdaas: { appId: "payee", viewId: "search" }, rendering: CHILD_RENDERING }) });
      submitMicrofrontend(db, microfrontend.publicId, { lockVersion: saved.lockVersion, actor: ana });
      observeCdaas(db, getMicrofrontend(db, microfrontend.publicId), { outcome: "found", projection: cdaasView("payee", "search") });

      // The originating Draft binds it as a child, and another Application binds the same identity.
      const document = readApplicationDraft(draft);
      saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: { ...document, children: [{ microfrontend: microfrontend.publicId, mountKind: "slot", mountKey: "search", required: true, module: null }] } });
      onboardApplication(db, "Payee lite", { launch: { kind: "mfe", microfrontend: microfrontend.publicId, mode: "esm", exportedModule: "./Widget" } });
      expect(db.$client.prepare("select count(*) as n from microfrontends").get()).toEqual({ n: 1 });
      expect(findMicrofrontend(db, microfrontend.publicId)!.id).toBe(microfrontend.id);
      expect(microfrontendHistory(db, microfrontend.id).map((event) => event.event).reverse()).toEqual(["created", "draft_started", "submitted", "ready"]);
      expect(microfrontendUses(db, microfrontend.id).map((use) => use.application.name)).toEqual(["Payee lite"]);
    });

    it("lets an Application's team edit an MFE its own team owns, and only open another team's", () => {
      const ours = registerMfe(db, "Payee search", { repository, ownerTeam: "Payments" });
      const theirs = registerMfe(db, "Card controls", { repository: buildSource(db, { name: "cards" }), ownerTeam: "Cards" });
      expect(assetAccess({ ownerTeam: "payments" }, getMicrofrontend(db, ours.publicId))).toEqual({ editable: true, reason: null });
      expect(assetAccess({ ownerTeam: "Payments" }, getMicrofrontend(db, theirs.publicId))).toEqual({ editable: false, reason: "Cards owns Card controls, so they change it" });
      expect(assetAccess({ ownerTeam: "Payments" }, { name: "Unowned", ownerTeam: null, lifecycle: "draft" })).toEqual({ editable: true, reason: null });
    });
  });

  describe("retirement", () => {
    it("retires an unused MFE with a reason, and refuses one an Application still uses", () => {
      const search = registerMfe(db, "Payee search", { repository });
      const spare = registerMfe(db, "Payee spare", { repository: buildSource(db, { name: "spare" }) });
      onboardApplication(db, "Payments workspace", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App" } });
      expect(() => retireMicrofrontend(db, search.publicId, { lockVersion: getMicrofrontend(db, search.publicId).lockVersion, reason: "Replaced", actor: cy })).toThrow(BlockedError);
      expect(() => retireMicrofrontend(db, spare.publicId, { lockVersion: 0, reason: "Replaced", actor: cy })).toThrow(StaleRecordError);
      const retired = retireMicrofrontend(db, spare.publicId, { lockVersion: getMicrofrontend(db, spare.publicId).lockVersion, reason: "Replaced by Payee search", actor: cy });
      expect(retired.lifecycle).toBe("retired");
      expect(() => startMicrofrontendDraft(db, spare.publicId, ana)).toThrow(/retired/);
      // A retired MFE frees its CDaaS view for another, and stays in the history.
      registerMfe(db, "Payee spare v2", { repository: buildSource(db, { name: "spare-2" }), cdaas: { appId: "payee", viewId: "payee-spare" } });
      expect(db.$client.prepare("select count(*) as n from external_references where external_id = 'payee/payee-spare'").get()).toEqual({ n: 2 });
      expect(microfrontendHistory(db, spare.id)[0]).toMatchObject({ event: "retired", reason: "Replaced by Payee search" });
    });
  });
});
