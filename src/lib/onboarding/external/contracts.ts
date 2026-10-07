import type { ExternalSystem } from "@/lib/db/schema";

/*
 * The published contracts Fabricate reads Studio and CDaaS under, pinned by
 * digest (design decision 7). The vendored files live in
 * openspec/api-specs/. A change to either file changes its digest, which
 * makes every observation read under the old contract Unknown until the
 * adapters are checked against the new one and this pin is updated.
 */

export const PINNED_CONTRACTS: Record<ExternalSystem, { file: string; digest: string }> = {
  studio: { file: "openspec/api-specs/studio-api.openapi.json", digest: "6493798ab22f038f654949a17288580661d2a237ef1383fe22663790ad119ed8" },
  cdaas: { file: "openspec/api-specs/cdaas-admin.openapi.json", digest: "8c47fa5b9dae4537414987741e793e0ece9af8aca0668b7fef63f64a2620c536" },
};

export interface AllowedOperation {
  system: ExternalSystem;
  /** The operation's ID in the vendored contract. */
  operationId: string;
  method: "GET";
  path: string;
  /** What onboarding reads it for. */
  purpose: string;
}

/**
 * Every request onboarding makes to Studio or CDaaS. Each is a GET the
 * vendored contract defines; nothing else can be called, because the
 * clients expose only these.
 */
export const ALLOWED_OPERATIONS = {
  studioChannel: { system: "studio", operationId: "getByUUId", method: "GET", path: "/api/v1/channels/{uuid}", purpose: "A Portal's Studio channel" },
  studioModuleGroup: { system: "studio", operationId: "getModuleGroupById", method: "GET", path: "/api/v1/module-groups/{moduleGroupId}", purpose: "A Web Application's Studio module group" },
  studioModule: { system: "studio", operationId: "getById", method: "GET", path: "/api/v1/module/{uuid}", purpose: "An MFE's Studio module, and how it renders" },
  studioMenu: { system: "studio", operationId: "getMenu", method: "GET", path: "/api/v1/menu/{uuid}", purpose: "A placement's Studio menu in one environment" },
  studioEnvironments: { system: "studio", operationId: "getAll", method: "GET", path: "/api/v1/environments", purpose: "The environment catalog teams select from, and the Studio environment each Portal environment names" },
  cdaasViewVersions: { system: "cdaas", operationId: "getAppViewVersions", method: "GET", path: "/v1/apps/{appId}/views/{viewId}", purpose: "An MFE's CDaaS application view and its versions" },
} as const satisfies Record<string, AllowedOperation>;

export type OperationName = keyof typeof ALLOWED_OPERATIONS;
