import { type JsonValue, compareCodeUnits, dump, sha256 } from "@repo-facts/contract";
import semver from "semver";
import { z } from "zod";
import { type Issue, ValidationError } from "@/lib/db/errors";
import { MAX_DOCUMENT_BYTES, RENDERING_MODES } from "@/lib/db/schema";
import { CAPABILITIES, IFRAME_PERMISSIONS, LOADING_STRATEGIES, SANDBOX_TOKENS } from "./vocabulary";

/*
 * The canonical documents of onboarding (design decision 3): Portal
 * contracts, MFE and external-host runtime contracts, launch configuration
 * for each rendering mode, entitlement sets, child host configuration, and
 * the projections Fabricate keeps of Studio and CDaaS state.
 *
 * Each schema is strict: an unknown field is refused rather than kept, so a
 * contract can't grow free-form shapes nothing validates. Canonicalizing a
 * parsed document orders every set and every list keyed by name, so
 * equivalent documents share one canonical text and one SHA-256 digest
 * whatever order their keys and items were written in.
 */

// ---------------------------------------------------------------------------
// Vocabularies

export { CAPABILITIES, CAPABILITY_LABELS, type Capability, IFRAME_PERMISSIONS, LOADING_STRATEGIES, RENDERING_MODE_LABELS, SANDBOX_TOKENS } from "./vocabulary";

export const MAX_LIST = 100;

// ---------------------------------------------------------------------------
// Values

const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_.-]{0,63}$/, "Use lowercase letters, digits, dots, dashes, or underscores, starting with a letter");
const packageName = z
  .string()
  .max(214)
  .regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "Enter an npm package name");
const versionRange = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => semver.validRange(value) !== null, "Enter a semver version range");
export const moduleName = z.string().trim().min(1).max(200).regex(/^[^\s]+$/, "A module name has no spaces");
const set = <T extends z.ZodType>(item: T, max = MAX_LIST) => z.array(item).max(max);

export const URL_PROBLEMS = {
  malformed: "Enter an absolute URL",
  scheme: "Use an https:// URL",
  credentials: "A URL can't contain a username, password, or token",
  fragment: "A URL can't contain a fragment (#...)",
} as const;

/** An https origin with no path, query, fragment, or credentials, such as https://access.example.com. */
export const httpsOrigin = z.string().max(300).refine((value) => originOf(value) === value, "Enter an https origin, such as https://access.example.com, with no path");

/** The origin of an absolute https URL with no credentials or fragment, or null when it's anything else. */
export function originOf(value: string): string | null {
  return urlProblem(value) ? null : new URL(value).origin;
}

/** Why a launch URL is unsafe, or null when it's an absolute https URL with no credentials or fragment. */
export function urlProblem(value: string): keyof typeof URL_PROBLEMS | null {
  if (value.length > 2048 || /\s/.test(value)) return "malformed";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "malformed";
  }
  if (url.protocol !== "https:") return "scheme";
  if (url.username || url.password || /^https:\/\/[^/]*@/i.test(value)) return "credentials";
  if (value.includes("#")) return "fragment";
  if (!url.hostname) return "malformed";
  return null;
}

/** An absolute https URL with no credentials or fragment. */
export const launchUrl = z
  .string()
  .max(2048)
  .superRefine((value, context) => {
    const problem = urlProblem(value);
    if (problem) context.addIssue({ code: "custom", message: URL_PROBLEMS[problem] });
  });

const sharedDependency = z.strictObject({ name: packageName, version: versionRange, singleton: z.boolean().default(false) });

// ---------------------------------------------------------------------------
// Entitlements and host configuration

export const ENTITLEMENT_OPERATORS = ["any", "all"] as const;

/** An entitlement set: the codes a visitor needs, any one or all of them. No codes means no restriction. */
export const entitlementsSchema = z.strictObject({
  codes: set(z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/, "An entitlement code is letters, digits, dots, colons, dashes, or underscores")),
  operator: z.enum(ENTITLEMENT_OPERATORS),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;
export const NO_ENTITLEMENTS: Entitlements = Object.freeze({ codes: [], operator: "any" }) as Entitlements;

/** Settings a host passes a child MFE: a flat object of strings, numbers, and booleans. */
export const hostConfigurationSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/, "A setting name is letters, digits, dots, dashes, or underscores"), z.union([z.string().max(500), z.number().finite(), z.boolean()]))
  .refine((value) => Object.keys(value).length <= 50, "Use 50 settings or fewer");
export type HostConfiguration = z.infer<typeof hostConfigurationSchema>;

// ---------------------------------------------------------------------------
// Contracts

/**
 * What a Portal offers the Applications placed in it: its capabilities and
 * events, the origins it loads code from, and the constraints of each
 * rendering mode it supports. A mode absent from `modes` isn't supported.
 */
export const portalContractSchema = z.strictObject({
  capabilities: set(z.enum(CAPABILITIES)),
  events: set(identifier),
  context: set(identifier),
  allowedOrigins: set(httpsOrigin, 50),
  modes: z.strictObject({
    iframe: z
      .strictObject({
        /** The sandbox tokens a framed Application may be given. */
        sandbox: set(z.enum(SANDBOX_TOKENS)),
        /** The permissions-policy features the Portal delegates. */
        permissions: set(z.enum(IFRAME_PERMISSIONS)),
        loading: z.enum(LOADING_STRATEGIES),
      })
      .optional(),
    esm: z
      .strictObject({
        loading: z.enum(LOADING_STRATEGIES),
        /** Dependencies the Portal provides through its import map. */
        shared: set(sharedDependency),
        /** Whether a module must declare its Subresource Integrity hash. */
        requireIntegrity: z.boolean(),
      })
      .optional(),
    module_federation_2: z
      .strictObject({
        loading: z.enum(LOADING_STRATEGIES),
        /** Dependencies the Portal's federation runtime shares. */
        shared: set(sharedDependency),
        /** The federation runtime versions a remote may expect. */
        runtimeVersion: versionRange,
      })
      .optional(),
  }),
});
export type PortalContract = z.infer<typeof portalContractSchema>;

/**
 * What an MFE, or externally hosted code that composes children, offers and
 * needs: the modules it exports and how each can be rendered, what it
 * requires of its host, what it provides to children it hosts, and the
 * dependencies it shares.
 */
export const runtimeContractSchema = z.strictObject({
  exports: z
    .array(z.strictObject({ name: moduleName, modes: z.array(z.enum(RENDERING_MODES)).min(1).max(3) }))
    .max(50),
  requires: z.strictObject({ capabilities: set(z.enum(CAPABILITIES)), events: set(identifier), context: set(identifier) }),
  provides: z.strictObject({ capabilities: set(z.enum(CAPABILITIES)), events: set(identifier), context: set(identifier) }),
  shared: set(sharedDependency),
});
export type RuntimeContract = z.infer<typeof runtimeContractSchema>;

export const EMPTY_RUNTIME_CONTRACT: RuntimeContract = {
  exports: [],
  requires: { capabilities: [], events: [], context: [] },
  provides: { capabilities: [], events: [], context: [] },
  shared: [],
};

// ---------------------------------------------------------------------------
// Launch configuration

const iframeSettings = { sandbox: set(z.enum(SANDBOX_TOKENS)).default([]), permissions: set(z.enum(IFRAME_PERMISSIONS)).default([]) };

/** An external launch target's location and settings, by rendering mode. */
export const externalLaunchSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("iframe"), documentUrl: launchUrl, ...iframeSettings }),
  z.strictObject({ mode: z.literal("esm"), moduleUrl: launchUrl, exportedModule: moduleName, integrity: z.string().regex(/^sha(256|384|512)-[A-Za-z0-9+/=]{40,100}$/).optional() }),
  z.strictObject({ mode: z.literal("module_federation_2"), manifestUrl: launchUrl, exposedModule: moduleName }),
]);
export type ExternalLaunch = z.infer<typeof externalLaunchSchema>;

/** A registered MFE launch target: its location comes from the MFE, and the configuration chooses its exported module. */
export const mfeLaunchSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("iframe"), ...iframeSettings }),
  z.strictObject({ mode: z.literal("esm"), exportedModule: moduleName }),
  z.strictObject({ mode: z.literal("module_federation_2"), exposedModule: moduleName }),
]);
export type MfeLaunch = z.infer<typeof mfeLaunchSchema>;

// ---------------------------------------------------------------------------
// Current-state projections

const uuid = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const optionalLabel = z.string().max(300).nullable();

/** What Fabricate keeps of a Studio channel: the evidence for a Portal. */
export const studioChannelProjection = z.strictObject({
  uuid,
  label: z.string().max(300),
  title: optionalLabel,
  sealId: z.string().max(64).nullable(),
  status: optionalLabel,
  runtimeIds: set(z.number().int()),
  menuUuids: set(uuid, 2000),
});
/** What Fabricate keeps of a Studio module group: the evidence for a Web Application. */
export const studioModuleGroupProjection = z.strictObject({
  uuid,
  name: z.string().max(300),
  sealId: z.string().max(64).nullable(),
  status: optionalLabel,
  runtimeIds: set(z.number().int()),
  moduleUuids: set(uuid, 2000),
});
/** What Fabricate keeps of a Studio module: the evidence for an MFE, and for how it renders. */
export const studioModuleProjection = z.strictObject({
  uuid,
  title: z.string().max(300),
  appId: z.string().max(128).nullable(),
  url: z.string().max(2048).nullable(),
  sealId: z.string().max(64).nullable(),
  status: optionalLabel,
  version: z.number().int().nullable(),
  typeLabels: set(z.string().max(100)),
});
/** What Fabricate keeps of a Studio menu: the evidence for a placement's route in one environment. */
export const studioMenuProjection = z.strictObject({
  uuid,
  name: z.string().max(300).nullable(),
  parentUuid: uuid.nullable(),
  channelUuid: uuid.nullable(),
  envId: z.number().int().nullable(),
  route: z.string().max(300).nullable(),
  moduleUuids: set(uuid, 200),
  entitlementCodes: set(z.string().max(200), 200),
});
/** What Fabricate keeps of a Studio environment. */
export const studioEnvironmentProjection = z.strictObject({ id: z.number().int(), label: z.string().max(100) });
/** What Fabricate keeps of a CDaaS application view: its versions, with build provenance and live state. */
export const cdaasViewProjection = z.strictObject({
  appId: z.string().max(128),
  viewId: z.string().max(128),
  versions: z
    .array(
      z.strictObject({
        name: z.string().max(200),
        live: z.boolean(),
        gitCommitHash: z.string().max(80).nullable(),
        branch: z.string().max(300).nullable(),
        buildNumber: z.string().max(100).nullable(),
        repositoryUrl: z.string().max(2048).nullable(),
        lastModified: z.string().max(40).nullable(),
      }),
    )
    .max(500),
});

export const PROJECTIONS = {
  channel: studioChannelProjection,
  module_group: studioModuleGroupProjection,
  module: studioModuleProjection,
  menu: studioMenuProjection,
  environment: studioEnvironmentProjection,
  application_view: cdaasViewProjection,
} as const;
export type ProjectionType = keyof typeof PROJECTIONS;
export type Projection<T extends ProjectionType> = z.infer<(typeof PROJECTIONS)[T]>;

// ---------------------------------------------------------------------------
// Canonical form and digest

/** A document parsed under its schema, in canonical form, with its text and digest. */
export interface Canonical<T> {
  value: T;
  text: string;
  digest: string;
}

/**
 * Parses +input+ strictly under +schema+, refusing it whole with every issue
 * located at its field, then orders every set and named list and serializes
 * it canonically. A document larger than the stored limit is refused.
 */
export function canonicalize<T>(schema: z.ZodType<T>, input: unknown, field = "document"): Canonical<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(issuesOf(parsed.error, field));
  const value = ordered(parsed.data as JsonValue) as T;
  const text = dump(value as JsonValue);
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new ValidationError([{ field, message: `The document is larger than ${MAX_DOCUMENT_BYTES / 1024} KB` }]);
  return { value, text, digest: sha256(text) };
}

/** SHA-256 of a value's canonical text. */
export function digestOf(value: JsonValue): string {
  return sha256(dump(ordered(value)));
}

/** Every Zod issue as a field-addressed issue under +prefix+. */
export function issuesOf(error: z.ZodError, prefix: string): Issue[] {
  return error.issues.map((issue) => ({ field: [prefix, ...issue.path.map(String)].filter(Boolean).join("."), message: issue.message }));
}

/**
 * Orders a parsed document: arrays of strings or numbers are sets, sorted and
 * deduplicated; arrays of objects with a `name` are sorted by it; anything
 * else keeps its order. Object keys are sorted when the text is written.
 */
function ordered(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items = value.map(ordered);
    if (items.every((item) => typeof item === "string")) return [...new Set(items as string[])].sort(compareCodeUnits);
    if (items.every((item) => typeof item === "number")) return [...new Set(items as number[])].sort((a, b) => a - b);
    if (items.every((item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.name === "string")) {
      return [...items].sort((a, b) => compareCodeUnits(String((a as { name: string }).name), String((b as { name: string }).name)) || compareCodeUnits(dump(a), dump(b)));
    }
    return items;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item !== undefined) Object.defineProperty(result, key, { value: ordered(item), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return value;
}
