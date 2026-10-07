import { z } from "zod";
import { type FabricateConfig, ONBOARDING_TOKENS, type OnboardingSettings } from "@/lib/config";
import type { ExternalSystem } from "@/lib/db/schema";
import type { Projection } from "../documents";
import { type CatalogReadResult, catalogFromStudio } from "../environments";
import { ALLOWED_OPERATIONS, type OperationName } from "./contracts";
import type { ReadResult } from "./evidence";

/*
 * Read-only clients for Studio and CDaaS (design decision 7). Each exposes
 * only the GET operations onboarding reads, from the allowlist; there's no
 * method that could send anything else. Every request is a GET with the
 * system's bearer token read from the environment at that moment, refuses a
 * redirect so the token can't follow it, and stops at the configured time and
 * size. A failure is described without the response body or the token.
 */

export interface RequestOptions {
  env?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
}

type Raw = { status: "ok"; body: unknown } | { status: "not_found" } | { status: "unavailable"; error: string };

const SYSTEM_LABELS: Record<ExternalSystem, string> = { studio: "Studio", cdaas: "CDaaS" };

/** The one request path: a GET of an allowlisted operation, under the system's limits. */
async function get(settings: OnboardingSettings, operation: OperationName, parameters: Record<string, string>, query: Record<string, string> = {}, options: RequestOptions = {}): Promise<Raw> {
  const definition = ALLOWED_OPERATIONS[operation];
  const endpoint = settings[definition.system];
  const label = SYSTEM_LABELS[definition.system];
  if (!endpoint) return { status: "unavailable", error: `${label} isn't configured` };
  const path = definition.path.replace(/\{(\w+)\}/g, (_match, name: string) => encodeURIComponent(parameters[name] ?? ""));
  const search = new URLSearchParams(query).toString();
  const url = `${endpoint.baseUrl}${path}${search ? `?${search}` : ""}`;
  const token = (options.env ?? process.env)[ONBOARDING_TOKENS[definition.system]]?.trim();
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: definition.method,
      headers: { accept: "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      redirect: "error",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted) return { status: "unavailable", error: `${label} didn't answer in time` };
    const cause = (error as Error).cause as (Error & { code?: string }) | undefined;
    if (/redirect/i.test(cause?.message ?? "")) return { status: "unavailable", error: `${label} answered with a redirect, which isn't followed` };
    return { status: "unavailable", error: `${label} couldn't be reached${cause?.code ? ` (${cause.code})` : ""}` };
  }
  if (response.status === 404 || response.status === 204) {
    await response.body?.cancel();
    return { status: "not_found" };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { status: "unavailable", error: `${label} answered HTTP ${response.status}` };
  }
  if (Number(response.headers.get("content-length") ?? 0) > settings.maxResponseBytes) {
    await response.body?.cancel();
    return { status: "unavailable", error: `${label}'s answer is larger than ${settings.maxResponseBytes} bytes` };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > settings.maxResponseBytes) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "unavailable", error: `${label}'s answer is larger than ${settings.maxResponseBytes} bytes` };
      }
      chunks.push(chunk);
    }
  } catch {
    return { status: "unavailable", error: timeout.aborted ? `${label} didn't answer in time` : `${label}'s answer was cut off` };
  }
  try {
    return { status: "ok", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { status: "unavailable", error: `${label}'s answer isn't valid JSON` };
  }
}

/** A read's result: the response's projection, or why it has none. */
function project<T>(raw: Raw, schema: z.ZodType<unknown>, toProjection: (body: never) => T, what: string): ReadResult {
  if (raw.status === "not_found") return { outcome: "not_found" };
  if (raw.status === "unavailable") return { outcome: "unavailable", error: raw.error };
  const parsed = schema.safeParse(raw.body);
  if (!parsed.success) return { outcome: "incompatible", error: `The ${what} response didn't match the contract at ${parsed.error.issues[0]!.path.join(".") || "its root"}` };
  return { outcome: "found", projection: toProjection(parsed.data as never) };
}

// Only the fields onboarding projects are read; anything else in a response is ignored.
const status = z.object({ name: z.string() }).nullish();
const channelResponse = z.object({ uuid: z.string(), label: z.string(), title: z.string().nullish(), sealId: z.number().int().nullish(), status, runtimeIds: z.array(z.number().int()).nullish(), menus: z.array(z.object({ menuUUId: z.string().nullish() })).nullish() });
const moduleGroupResponse = z.object({ uuid: z.string(), name: z.string(), sealId: z.number().int().nullish(), status, runtimeIds: z.array(z.number().int()).nullish(), modules: z.array(z.object({ uuid: z.string().nullish() })).nullish() });
const moduleResponse = z.object({ uuid: z.string(), title: z.string(), appId: z.string().nullish(), url: z.string().nullish(), sealId: z.number().int().nullish(), status, version: z.number().int().nullish(), types: z.array(z.object({ name: z.string().nullish() })).nullish() });
const menuResponse = z.object({
  uuid: z.string(),
  name: z.string().nullish(),
  parentUUId: z.string().nullish(),
  channelUUId: z.string().nullish(),
  envId: z.number().int().nullish(),
  modules: z.array(z.object({ uuid: z.string().nullish() })).nullish(),
  entitlements: z.array(z.object({ entCodes: z.string().nullish() })).nullish(),
});
const environmentResponse = z.object({ id: z.number().int(), label: z.string() });
const viewVersionsResponse = z.object({
  lobAppVersionMetadata: z
    .array(z.object({ versionName: z.string(), live: z.boolean().nullish(), gitCommitHash: z.string().nullish(), branchName: z.string().nullish(), buildNumber: z.string().nullish(), repoUrl: z.string().nullish(), lastModified: z.string().nullish() }))
    .nullish(),
});

const uuids = (items: readonly { uuid?: string | null; menuUUId?: string | null }[] | null | undefined) => [...new Set((items ?? []).map((item) => item.uuid ?? item.menuUUId).filter((value): value is string => Boolean(value)))];

/** Studio's GET operations onboarding reads, and nothing else. */
export interface StudioClient {
  channel(uuid: string, options?: RequestOptions): Promise<ReadResult>;
  moduleGroup(uuid: string, options?: RequestOptions): Promise<ReadResult>;
  module(uuid: string, options?: RequestOptions): Promise<ReadResult>;
  menu(uuid: string, options?: RequestOptions): Promise<ReadResult>;
  /** Every Studio environment, to find the one a Portal environment names. */
  environment(label: string, options?: RequestOptions): Promise<ReadResult>;
  /** Studio's whole environment list, as the environment catalog teams select from. */
  environments(options?: RequestOptions): Promise<CatalogReadResult>;
}

/** CDaaS Admin's GET operation onboarding reads, and nothing else. */
export interface CdaasClient {
  applicationView(appId: string, viewId: string, options?: RequestOptions): Promise<ReadResult>;
}

export function studioClient(config: Pick<FabricateConfig, "onboarding">): StudioClient {
  const settings = config.onboarding;
  return {
    channel: async (uuid, options) =>
      project(
        await get(settings, "studioChannel", { uuid }, {}, options),
        channelResponse,
        (body: z.infer<typeof channelResponse>): Projection<"channel"> => ({
          uuid: body.uuid,
          label: body.label,
          title: body.title ?? null,
          sealId: body.sealId == null ? null : String(body.sealId),
          status: body.status?.name ?? null,
          runtimeIds: body.runtimeIds ?? [],
          menuUuids: uuids(body.menus),
        }),
        "Studio channel",
      ),
    moduleGroup: async (uuid, options) =>
      project(
        await get(settings, "studioModuleGroup", { moduleGroupId: uuid }, {}, options),
        moduleGroupResponse,
        (body: z.infer<typeof moduleGroupResponse>): Projection<"module_group"> => ({ uuid: body.uuid, name: body.name, sealId: body.sealId == null ? null : String(body.sealId), status: body.status?.name ?? null, runtimeIds: body.runtimeIds ?? [], moduleUuids: uuids(body.modules) }),
        "Studio module group",
      ),
    module: async (uuid, options) =>
      project(
        await get(settings, "studioModule", { uuid }, {}, options),
        moduleResponse,
        (body: z.infer<typeof moduleResponse>): Projection<"module"> => ({
          uuid: body.uuid,
          title: body.title,
          appId: body.appId ?? null,
          url: body.url ?? null,
          sealId: body.sealId == null ? null : String(body.sealId),
          status: body.status?.name ?? null,
          version: body.version ?? null,
          typeLabels: [...new Set((body.types ?? []).map((type) => type.name).filter((name): name is string => Boolean(name)))],
        }),
        "Studio module",
      ),
    menu: async (uuid, options) =>
      project(
        await get(settings, "studioMenu", { uuid }, {}, options),
        menuResponse,
        (body: z.infer<typeof menuResponse>): Projection<"menu"> => ({
          uuid: body.uuid,
          name: body.name ?? null,
          parentUuid: body.parentUUId ?? null,
          channelUuid: body.channelUUId ?? null,
          envId: body.envId ?? null,
          // Studio's menu contract has no route field; a route isn't inferred from its attributes.
          route: null,
          moduleUuids: uuids(body.modules),
          entitlementCodes: [...new Set((body.entitlements ?? []).flatMap((entitlement) => (entitlement.entCodes ?? "").split(",")).map((code) => code.trim()).filter(Boolean))],
        }),
        "Studio menu",
      ),
    environment: async (label, options) => {
      const raw = await get(settings, "studioEnvironments", {}, {}, options);
      if (raw.status !== "ok") return project(raw, environmentResponse, (body) => body, "Studio environment");
      // The contract declares one environment, but the operation lists them all; either shape is read.
      const list = z.array(environmentResponse).safeParse(Array.isArray(raw.body) ? raw.body : [raw.body]);
      if (!list.success) return { outcome: "incompatible", error: "The Studio environments response didn't match the contract" };
      const match = list.data.find((environment) => environment.label.toLowerCase() === label.toLowerCase());
      return match ? { outcome: "found", projection: { id: match.id, label: match.label } satisfies Projection<"environment"> } : { outcome: "not_found" };
    },
    environments: async (options) => {
      const raw = await get(settings, "studioEnvironments", {}, {}, options);
      if (raw.status === "unavailable") return { outcome: "unavailable", error: raw.error };
      if (raw.status === "not_found") return { outcome: "incompatible", error: "Studio has no environment list at the contract's path" };
      const list = z.array(environmentResponse).max(500).safeParse(Array.isArray(raw.body) ? raw.body : [raw.body]);
      if (!list.success) return { outcome: "incompatible", error: `The Studio environments response didn't match the contract at ${list.error.issues[0]!.path.join(".") || "its root"}` };
      return { outcome: "found", ...catalogFromStudio(list.data) };
    },
  };
}

export function cdaasClient(config: Pick<FabricateConfig, "onboarding">): CdaasClient {
  const settings = config.onboarding;
  return {
    applicationView: async (appId, viewId, options) =>
      project(
        await get(settings, "cdaasViewVersions", { appId, viewId }, {}, options),
        viewVersionsResponse,
        (body: z.infer<typeof viewVersionsResponse>): Projection<"application_view"> => ({
          appId,
          viewId,
          versions: (body.lobAppVersionMetadata ?? []).slice(0, 500).map((version) => ({
            name: version.versionName,
            live: version.live ?? false,
            gitCommitHash: version.gitCommitHash ?? null,
            branch: version.branchName ?? null,
            buildNumber: version.buildNumber ?? null,
            repositoryUrl: version.repoUrl ?? null,
            lastModified: version.lastModified ?? null,
          })),
        }),
        "CDaaS application view",
      ),
  };
}
