import { type JsonObject, type JsonValue, compareCodeUnits, dump, sha256 } from "@repo-facts/contract";
import { z } from "zod";
import { ValidationError } from "@/lib/db/errors";
import { type FormatVersion, MAX_DOCUMENT_BYTES, RENDERING_MODES, type RenderingMode } from "@/lib/db/schema";
import { EMPTY_RUNTIME_CONTRACT, MAX_LIST, type RuntimeContract, issuesOf, moduleName, runtimeContractSchema } from "./documents";
import type { OnboardingSubject } from "@/lib/db/schema";

/*
 * Document formats (simplify-web-onboarding design decision 3). Every
 * revision names its format. Version 1 documents held platform policy the
 * teams don't own: Portal runtimes, per-environment entitlements and their
 * inheritance, a Portal contract, an Application's global environments and
 * required capabilities, an external host contract, child host
 * configuration, and an MFE's runtime contract. Version 2 documents hold
 * only what the Portal and Application teams decide.
 *
 * Submitted v1 revisions are never rewritten: their documents are read with
 * the v1 schemas and keep their digests. A Draft started from a v1 revision,
 * or a v1 Draft opened again, is converted: the team-owned values move into
 * the v2 Draft, every removed value is kept under `legacy` for review only,
 * and a choice the conversion can't make is a focused migration issue the
 * team resolves before submitting. Submission never includes `legacy`.
 */

const text = (max: number) => z.string().max(max);

// ---------------------------------------------------------------------------
// Legacy values

export const legacyIssueSchema = z.strictObject({ code: text(80), location: text(200), message: text(500) });
export type LegacyIssue = z.infer<typeof legacyIssueSchema>;

/** What a converted Draft kept from version 1: the values v2 no longer collects, and the choices left to the team. */
export const legacySchema = z.strictObject({
  /** The revision whose v1 document supplied the values. */
  fromRevision: z.number().int().min(1),
  /** Values v1 collected that v2 doesn't, kept as history. Nothing reads them as current configuration. */
  values: z.record(z.string(), z.unknown()),
  /** Choices the conversion couldn't make. Each blocks submission until the team makes it. */
  issues: z.array(legacyIssueSchema).max(20).default([]),
});
export type Legacy = z.infer<typeof legacySchema>;

/** The Draft with its migration issues at or under +location+ resolved, because the team has now made that choice. */
export function resolveLegacyIssues<T extends { legacy: Legacy | null }>(draft: T, location: string): T {
  if (!draft.legacy) return draft;
  const issues = draft.legacy.issues.filter((issue) => issue.location !== location && !issue.location.startsWith(`${location}.`));
  return issues.length === draft.legacy.issues.length ? draft : { ...draft, legacy: { ...draft.legacy, issues } };
}

// ---------------------------------------------------------------------------
// Portal

const menuItem = z.strictObject({ key: text(80), label: text(150), parent: text(80).nullable().default(null), order: z.number().int().min(0).max(100_000).default(0) });
const menuDraft = z.array(menuItem).max(500).default([]);
const entitlementsDraft = z.strictObject({ codes: z.array(text(100)).max(MAX_LIST), operator: z.enum(["any", "all"]) });

/** A v1 Portal document: a v1 Draft, or the canonical document of a v1 submitted revision. */
export const portalDocumentV1 = z.strictObject({
  ownerTeam: text(300).nullable().default(null),
  sealId: text(100).nullable().default(null),
  runtimes: z.array(text(100)).max(20).default([]),
  environments: z
    .array(
      z.strictObject({
        key: text(60),
        runtime: text(100).nullable().default(null),
        enabled: z.boolean().default(true),
        /** Null when the environment inherited another's entitlements. */
        entitlements: entitlementsDraft.nullable().default(null),
        inheritFrom: text(60).nullable().default(null),
      }),
    )
    .max(20)
    .default([]),
  menu: menuDraft,
  contract: z.record(z.string(), z.unknown()).default({}),
});
export type PortalDocumentV1 = z.infer<typeof portalDocumentV1>;

/**
 * A v2 Portal Draft: the owning team, an optional SEAL ID, the catalog
 * environments the Portal enables, and its menu groups. Incomplete values
 * are kept and checked when it's submitted; any other field is refused.
 */
export const portalDraftSchema = z.strictObject({
  ownerTeam: text(300).nullable().default(null),
  sealId: text(100).nullable().default(null),
  /** The keys of the catalog environments the Portal enables. */
  environments: z.array(text(60)).max(20).default([]),
  menu: menuDraft,
  legacy: legacySchema.nullable().default(null),
});
export type PortalDraft = z.infer<typeof portalDraftSchema>;

/** The canonical document of a submitted v2 Portal revision. */
export const portalDocumentV2 = z.strictObject({
  ownerTeam: z.string(),
  sealId: z.string().nullable(),
  environments: z.array(z.string()),
  menu: z.array(z.strictObject({ key: z.string(), label: z.string(), parent: z.string().nullable(), order: z.number().int() })),
});
export type PortalDocumentV2 = z.infer<typeof portalDocumentV2>;

export function emptyPortalDraft(input: { ownerTeam?: string | null; sealId?: string | null } = {}): PortalDraft {
  return portalDraftSchema.parse({ ownerTeam: input.ownerTeam ?? null, sealId: input.sealId ?? null });
}

/**
 * A v2 Draft from a v1 Portal document. The owning team, SEAL ID, menu,
 * and the environments the Portal enabled carry over; runtimes, each
 * environment's runtime and entitlements, inheritance, disabled
 * environments, and the contract are kept as history. Entitlements now
 * belong to each placement, where the Portal team reviews them.
 */
export function portalDraftFromV1(document: JsonValue, fromRevision: number): PortalDraft {
  const parsed = portalDocumentV1.safeParse(document);
  if (!parsed.success) return { ...emptyPortalDraft(), legacy: unreadable(document, fromRevision) };
  const v1 = parsed.data;
  return portalDraftSchema.parse({
    ownerTeam: v1.ownerTeam,
    sealId: v1.sealId,
    environments: [...new Set(v1.environments.filter((environment) => environment.enabled).map((environment) => environment.key.trim()))].filter(Boolean),
    menu: v1.menu,
    legacy: { fromRevision, values: { runtimes: v1.runtimes, environments: v1.environments, contract: v1.contract }, issues: [] },
  });
}

// ---------------------------------------------------------------------------
// MFE

/** A v1 MFE document: a v1 Draft, or the canonical document of a v1 submitted revision. */
export const microfrontendDocumentV1 = z.strictObject({
  name: text(300).default(""),
  ownerTeam: text(300).nullable().default(null),
  sealId: text(100).nullable().default(null),
  repository: text(40).nullable().default(null),
  workspacePath: text(400).nullable().default(null),
  cdaas: z.strictObject({ appId: text(200), viewId: text(200) }).nullable().default(null),
  contract: z.record(z.string(), z.unknown()).default({ ...EMPTY_RUNTIME_CONTRACT }),
});
export type MicrofrontendDocumentV1 = z.infer<typeof microfrontendDocumentV1>;

/** A document an iframe loads, relative to the CDaaS view, such as index.html or frames/print.html. */
export const documentEntry = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?!\/)(?!.*\/\/)(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._~@/-]+$/, "Enter a document path relative to the CDaaS view, such as index.html");

/** An MFE Draft's rendering metadata: which modes load it and through what. Incomplete values are kept until it's submitted. */
export const renderingDraftSchema = z.strictObject({
  /** Present when a Portal can frame the MFE; the entry names its document when it isn't the view's root. */
  iframe: z.strictObject({ entry: text(300).nullable().default(null) }).nullable().default(null),
  esm: z.strictObject({ exports: z.array(text(300)).max(50).default([]) }).nullable().default(null),
  module_federation_2: z.strictObject({ exposes: z.array(text(300)).max(50).default([]) }).nullable().default(null),
});
export type RenderingDraft = z.infer<typeof renderingDraftSchema>;
export const EMPTY_RENDERING: RenderingDraft = Object.freeze({ iframe: null, esm: null, module_federation_2: null }) as RenderingDraft;

/**
 * The rendering metadata a submitted v2 MFE freezes: the document an iframe
 * loads, the modules an ESM import loads, and the modules a Module
 * Federation 2 host loads. A mode that's null isn't supported.
 */
export const renderingSchema = z
  .strictObject({
    iframe: z.strictObject({ entry: documentEntry.nullable() }).nullable(),
    esm: z.strictObject({ exports: z.array(moduleName).min(1, "Name at least one exported module").max(50) }).nullable(),
    module_federation_2: z.strictObject({ exposes: z.array(moduleName).min(1, "Name at least one exposed module").max(50) }).nullable(),
  })
  .refine((value) => value.iframe !== null || value.esm !== null || value.module_federation_2 !== null, { message: "Say how at least one rendering mode loads this MFE", path: ["iframe"] });
export type Rendering = z.infer<typeof renderingSchema>;

/**
 * A v2 MFE Draft: its name, owning team, optional SEAL ID, source
 * Repository and workspace path, CDaaS view, and rendering metadata. There's
 * no owner email, no capability, event, or context declaration, and no
 * shared-dependency or host policy.
 */
export const microfrontendDraftSchema = z.strictObject({
  name: text(300).default(""),
  ownerTeam: text(300).nullable().default(null),
  sealId: text(100).nullable().default(null),
  /** The Repository's public ID. */
  repository: text(40).nullable().default(null),
  workspacePath: text(400).nullable().default(null),
  cdaas: z.strictObject({ appId: text(200), viewId: text(200) }).nullable().default(null),
  rendering: renderingDraftSchema.default({ ...EMPTY_RENDERING }),
  legacy: legacySchema.nullable().default(null),
});
export type MicrofrontendDraft = z.infer<typeof microfrontendDraftSchema>;

/** The canonical document of a submitted v2 MFE revision. */
export const microfrontendDocumentV2 = z.strictObject({
  name: z.string(),
  ownerTeam: z.string(),
  sealId: z.string().nullable(),
  repository: z.string(),
  workspacePath: z.string().nullable(),
  cdaas: z.strictObject({ appId: z.string(), viewId: z.string() }).nullable(),
  rendering: renderingSchema,
});

/**
 * The rendering metadata a v1 runtime contract implies. Its ESM and Module
 * Federation 2 exports carry over by name. One framed export makes the MFE
 * frameable, with its name as the document when it names one; more than one
 * leaves the document for the team to choose. What the contract required,
 * provided, and shared has no v2 counterpart.
 */
export function renderingFromV1(contract: unknown): { rendering: RenderingDraft; issues: LegacyIssue[] } {
  const parsed = runtimeContractSchema.safeParse({ ...EMPTY_RUNTIME_CONTRACT, ...(contract !== null && typeof contract === "object" ? contract : {}) });
  if (!parsed.success) return { rendering: { ...EMPTY_RENDERING }, issues: [{ code: "migration.contract_unreadable", location: "rendering", message: "The earlier contract couldn't be read. Say how each rendering mode loads this MFE" }] };
  const named = (mode: RenderingMode) => [...new Set(parsed.data.exports.filter((entry) => entry.modes.includes(mode)).map((entry) => entry.name))].sort(compareCodeUnits);
  const esm = named("esm");
  const federated = named("module_federation_2");
  const framed = named("iframe");
  const issues: LegacyIssue[] = [];
  let iframe: RenderingDraft["iframe"] = null;
  if (framed.length === 1) iframe = { entry: documentEntry.safeParse(framed[0]).success && /\.html?$/i.test(framed[0]!) ? framed[0]! : null };
  else if (framed.length > 1) {
    iframe = { entry: null };
    issues.push({ code: "migration.iframe_entry", location: "rendering.iframe", message: `The earlier contract framed ${framed.join(" and ")}. Choose the document a Portal frames, or leave the entry empty to frame the view's root` });
  }
  return { rendering: { iframe, esm: esm.length ? { exports: esm } : null, module_federation_2: federated.length ? { exposes: federated } : null }, issues };
}

/** The rendering metadata of a submitted MFE revision of either format: its frozen v2 metadata, or what its v1 contract implies. */
export function renderingOfRevision(row: { formatVersion: number; rendering: string | null; contract: string | null }): Rendering | null {
  if (row.formatVersion >= 2) {
    const parsed = row.rendering ? renderingSchema.safeParse(JSON.parse(row.rendering)) : null;
    return parsed?.success ? parsed.data : null;
  }
  if (!row.contract) return null;
  const { rendering } = renderingFromV1(JSON.parse(row.contract));
  const parsed = renderingSchema.safeParse(rendering);
  return parsed.success ? parsed.data : null;
}

/** The modules +mode+ can load from an MFE, or null when the mode can't load it. Framing loads a document, so it names no module. */
export function modulesFor(rendering: Pick<Rendering, RenderingMode>, mode: RenderingMode): string[] | null {
  if (mode === "iframe") return rendering.iframe ? [] : null;
  if (mode === "esm") return rendering.esm?.exports ?? null;
  return rendering.module_federation_2?.exposes ?? null;
}

/** The modes that can load an MFE, in the order they're offered. */
export function supportedModes(rendering: Pick<Rendering, RenderingMode>): RenderingMode[] {
  return RENDERING_MODES.filter((mode) => modulesFor(rendering, mode) !== null);
}

/**
 * A v2 Draft from a v1 MFE document. Identity, source, and CDaaS view
 * carry over, and the contract's exports become rendering metadata where
 * that's unambiguous; the whole contract stays as history.
 */
export function microfrontendDraftFromV1(document: JsonValue, fromRevision: number): MicrofrontendDraft {
  const parsed = microfrontendDocumentV1.safeParse(document);
  if (!parsed.success) return { ...microfrontendDraftSchema.parse({}), legacy: unreadable(document, fromRevision) };
  const v1 = parsed.data;
  const { rendering, issues } = renderingFromV1(v1.contract);
  return microfrontendDraftSchema.parse({ name: v1.name, ownerTeam: v1.ownerTeam, sealId: v1.sealId, repository: v1.repository, workspacePath: v1.workspacePath, cdaas: v1.cdaas, rendering, legacy: { fromRevision, values: { contract: v1.contract }, issues } });
}

// ---------------------------------------------------------------------------
// Web Application

export const launchDraftSchema = z.strictObject({
  kind: z.enum(["mfe", "external"]).nullable().default(null),
  /** The launch MFE's public ID. */
  microfrontend: text(40).nullable().default(null),
  mode: z.enum(RENDERING_MODES).nullable().default(null),
  documentUrl: text(2100).nullable().default(null),
  moduleUrl: text(2100).nullable().default(null),
  exportedModule: text(300).nullable().default(null),
  manifestUrl: text(2100).nullable().default(null),
  exposedModule: text(300).nullable().default(null),
  sandbox: z.array(text(80)).max(20).default([]),
  permissions: z.array(text(80)).max(20).default([]),
  integrity: text(200).nullable().default(null),
});
export type LaunchDraft = z.infer<typeof launchDraftSchema>;

const confirmationDraft = z
  .strictObject({
    kind: z.enum(["inferred", "override", "explicit"]),
    /** The confirmed candidate's key, for an inference. */
    candidate: text(64).nullable().default(null),
    by: text(300),
    at: text(40),
    /** The launch values it confirmed; changing them clears it. */
    launchDigest: text(64),
  })
  .nullable()
  .default(null);

const placementDraft = z.strictObject({
  /** The placement this request revises; null for a new one. */
  placement: text(40).nullable().default(null),
  portal: text(40),
  menuParent: text(80).nullable().default(null),
  route: text(300).default(""),
  label: text(150).default(""),
  order: z.number().int().min(0).max(100_000).default(0),
  /** The target Portal's environments the Application appears in. */
  environments: z.array(text(60)).max(20).default([]),
  /** What a visitor needs, requested here and accepted or changed by the Portal team. */
  entitlements: entitlementsDraft.default({ codes: [], operator: "any" }),
  defaultRequested: z.boolean().default(false),
});

/** A v1 Web Application document: a v1 Draft, or the canonical document of a v1 submitted revision. */
export const applicationDocumentV1 = z.strictObject({
  name: text(300).default(""),
  ownerTeam: text(300).nullable().default(null),
  sealId: text(100).nullable().default(null),
  environments: z.array(text(60)).max(20).default([]),
  requiredCapabilities: z.array(text(60)).max(20).default([]),
  launch: launchDraftSchema.default(launchDraftSchema.parse({})),
  confirmation: confirmationDraft,
  hostContract: z.record(z.string(), z.unknown()).nullable().default(null),
  children: z
    .array(
      z.strictObject({
        microfrontend: text(40),
        mountKind: z.enum(["route", "slot"]).nullable().default(null),
        mountKey: text(300).default(""),
        required: z.boolean().default(true),
        hostConfiguration: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(50)
    .default([]),
  placements: z.array(placementDraft).max(50).default([]),
});
export type ApplicationDocumentV1 = z.infer<typeof applicationDocumentV1>;

/**
 * A v2 Web Application Draft: its identity, one launch target and its
 * rendering mode, the child MFEs it composes, and its Portal placement
 * requests with their environments and entitlements. There's no global
 * environment list, no required Portal capability, no host contract, and
 * no host configuration for children.
 */
export const applicationDraftSchema = z.strictObject({
  name: text(300).default(""),
  ownerTeam: text(300).nullable().default(null),
  sealId: text(100).nullable().default(null),
  launch: launchDraftSchema.default(launchDraftSchema.parse({})),
  /** How the rendering mode was settled, for the launch values it was settled on. */
  confirmation: confirmationDraft,
  children: z
    .array(
      z.strictObject({
        microfrontend: text(40),
        mountKind: z.enum(["route", "slot"]).nullable().default(null),
        mountKey: text(300).default(""),
        required: z.boolean().default(true),
        /** The child's module the host mounts; settled from the child's rendering metadata when it offers one. */
        module: text(300).nullable().default(null),
      }),
    )
    .max(50)
    .default([]),
  placements: z.array(placementDraft).max(50).default([]),
  legacy: legacySchema.nullable().default(null),
});
export type ApplicationDraft = z.infer<typeof applicationDraftSchema>;

/** The canonical document of a submitted v2 Application revision. */
export const applicationDocumentV2 = z.strictObject({
  name: z.string(),
  ownerTeam: z.string(),
  sealId: z.string().nullable(),
  launch: z.strictObject({
    kind: z.enum(["mfe", "external"]),
    microfrontend: z.string().nullable(),
    mode: z.enum(RENDERING_MODES),
    documentUrl: z.string().nullable(),
    moduleUrl: z.string().nullable(),
    exportedModule: z.string().nullable(),
    manifestUrl: z.string().nullable(),
    exposedModule: z.string().nullable(),
    sandbox: z.array(z.string()),
    permissions: z.array(z.string()),
    integrity: z.string().nullable(),
  }),
  confirmation: z.strictObject({ kind: z.enum(["inferred", "override", "explicit"]), candidate: z.string().nullable(), by: z.string(), at: z.string(), launchDigest: z.string() }),
  children: z.array(z.strictObject({ microfrontend: z.string(), mountKind: z.enum(["route", "slot"]), mountKey: z.string(), required: z.boolean(), module: z.string().nullable() })),
  placements: z.array(
    z.strictObject({
      placement: z.string().nullable(),
      portal: z.string(),
      menuParent: z.string().nullable(),
      route: z.string(),
      label: z.string(),
      order: z.number().int(),
      environments: z.array(z.string()),
      entitlements: z.strictObject({ codes: z.array(z.string()), operator: z.enum(["any", "all"]) }),
      defaultRequested: z.boolean(),
    }),
  ),
});
export type ApplicationDocumentV2 = z.infer<typeof applicationDocumentV2>;

/**
 * A v2 Draft from a v1 Application document. Identity, launch target,
 * rendering confirmation, children and their mounts, and placement requests
 * with their environments and entitlements carry over. Global environments,
 * required capabilities, the external host contract, and child host
 * configuration are kept as history.
 */
export function applicationDraftFromV1(document: JsonValue, fromRevision: number): ApplicationDraft {
  const parsed = applicationDocumentV1.safeParse(document);
  if (!parsed.success) return { ...applicationDraftSchema.parse({}), legacy: unreadable(document, fromRevision) };
  const v1 = parsed.data;
  const hostConfiguration = v1.children.filter((child) => Object.keys(child.hostConfiguration).length > 0).map((child) => ({ microfrontend: child.microfrontend, hostConfiguration: child.hostConfiguration }));
  return applicationDraftSchema.parse({
    name: v1.name,
    ownerTeam: v1.ownerTeam,
    sealId: v1.sealId,
    launch: v1.launch,
    confirmation: v1.confirmation,
    children: v1.children.map((child) => ({ microfrontend: child.microfrontend, mountKind: child.mountKind, mountKey: child.mountKey, required: child.required, module: null })),
    placements: v1.placements,
    legacy: { fromRevision, values: { environments: v1.environments, requiredCapabilities: v1.requiredCapabilities, hostContract: v1.hostContract, hostConfiguration }, issues: [] },
  });
}

// ---------------------------------------------------------------------------
// Reading any format

/** A revision's stored document, with its format and number. */
export interface StoredDocument {
  number: number;
  formatVersion: FormatVersion;
  document: JsonObject;
}

const DRAFTS = {
  portal: { schema: portalDraftSchema, fromV1: portalDraftFromV1 },
  application: { schema: applicationDraftSchema, fromV1: applicationDraftFromV1 },
  microfrontend: { schema: microfrontendDraftSchema, fromV1: microfrontendDraftFromV1 },
} as const;

type DraftOf<K extends OnboardingSubject> = z.infer<(typeof DRAFTS)[K]["schema"]>;

/**
 * The v2 Draft a revision opens as: a v2 document as it's stored, or a v1
 * document converted, keeping its removed values under `legacy`. A stored
 * v2 document that no longer parses reads as empty.
 */
export function draftOfDocument<K extends OnboardingSubject>(kind: K, stored: StoredDocument): DraftOf<K> {
  const { schema, fromV1 } = DRAFTS[kind];
  if (stored.formatVersion === 1) return fromV1(stored.document, stored.number) as DraftOf<K>;
  const parsed = schema.safeParse(stored.document);
  return (parsed.success ? parsed.data : schema.parse({})) as DraftOf<K>;
}

/** The document a new Draft starts from a submitted revision of either format: its v2 document, or its v1 document converted. */
export function draftFromSubmitted(kind: OnboardingSubject, base: StoredDocument): JsonObject {
  return (base.formatVersion === 1 ? DRAFTS[kind].fromV1(base.document, base.number) : base.document) as unknown as JsonObject;
}

// ---------------------------------------------------------------------------
// Canonical form and digest

/** A document in its format's canonical form: the parsed value, its text, and its SHA-256. */
export interface CanonicalDocument {
  value: JsonObject;
  text: string;
  digest: string;
}

const CANONICAL = {
  portal: { 1: portalDocumentV1, 2: portalDocumentV2 },
  application: { 1: applicationDocumentV1, 2: applicationDocumentV2 },
  microfrontend: { 1: microfrontendDocumentV1, 2: microfrontendDocumentV2 },
} as const satisfies Record<OnboardingSubject, Record<FormatVersion, z.ZodType>>;

/** SHA-256 of a document's canonical text: what a submitted revision's digest is. */
export function documentDigest(document: JsonValue): string {
  return sha256(dump(document));
}

/**
 * A submitted document in canonical form under its format, refused whole
 * with every issue at its field. A v1 document is read as it was written:
 * its text and digest are what v1 stored, so history keeps its digests. A
 * v2 document is ordered first, so equivalent documents share one text and
 * one digest whatever order their keys and lists were written in.
 */
export function canonicalDocument(kind: OnboardingSubject, version: FormatVersion, input: unknown): CanonicalDocument {
  const parsed = (CANONICAL[kind][version] as z.ZodType).safeParse(input);
  if (!parsed.success) throw new ValidationError(issuesOf(parsed.error, "document"));
  const value = (version === 1 ? input : orderV2(kind, parsed.data as JsonObject)) as JsonObject;
  const textValue = dump(value);
  if (Buffer.byteLength(textValue) > MAX_DOCUMENT_BYTES) throw new ValidationError([{ field: "document", message: `The document is larger than ${MAX_DOCUMENT_BYTES / 1024} KB` }]);
  return { value, text: textValue, digest: sha256(textValue) };
}

const sorted = (values: readonly string[]) => [...new Set(values)].sort(compareCodeUnits);

/** A v2 document with every set sorted and every keyed list in its canonical order. */
function orderV2(kind: OnboardingSubject, value: JsonObject): JsonObject {
  if (kind === "portal") {
    const portal = value as unknown as PortalDocumentV2;
    return { ...portal, environments: sorted(portal.environments), menu: [...portal.menu].sort((a, b) => compareCodeUnits(a.key, b.key)) } as unknown as JsonObject;
  }
  if (kind === "microfrontend") {
    const mfe = value as unknown as z.infer<typeof microfrontendDocumentV2>;
    const rendering = mfe.rendering;
    return {
      ...mfe,
      rendering: { iframe: rendering.iframe, esm: rendering.esm ? { exports: sorted(rendering.esm.exports) } : null, module_federation_2: rendering.module_federation_2 ? { exposes: sorted(rendering.module_federation_2.exposes) } : null },
    } as unknown as JsonObject;
  }
  const application = value as unknown as ApplicationDocumentV2;
  return {
    ...application,
    launch: { ...application.launch, sandbox: sorted(application.launch.sandbox), permissions: sorted(application.launch.permissions) },
    children: [...application.children].sort((a, b) => compareCodeUnits(a.mountKind, b.mountKind) || compareCodeUnits(a.mountKey, b.mountKey) || compareCodeUnits(a.microfrontend, b.microfrontend)),
    placements: application.placements
      .map((placement) => ({ ...placement, environments: sorted(placement.environments), entitlements: { codes: sorted(placement.entitlements.codes), operator: placement.entitlements.operator } }))
      .sort((a, b) => compareCodeUnits(a.portal, b.portal) || compareCodeUnits(a.route, b.route) || compareCodeUnits(a.placement ?? "", b.placement ?? "")),
  } as unknown as JsonObject;
}

/** A v1 document that doesn't parse under its v1 schema: its whole text is kept as history, and the team starts the v2 values again. */
function unreadable(document: JsonValue, fromRevision: number): Legacy {
  return { fromRevision, values: { document }, issues: [{ code: "migration.unreadable", location: "legacy", message: `Revision ${fromRevision}'s earlier-format values couldn't be read. Enter the values again` }] };
}

export type { RuntimeContract };
