import type { LanguageModel } from "ai";
import { GATEWAY_CREDENTIALS, type PrototypesSettings, getConfig } from "@/lib/config";
import { mockModel } from "./mock";

/**
 * Model access through Vercel AI Gateway (design.md, decision 3). Each step
 * has a model setting of its own; `mock` selects the scripted model the tests
 * use. A plain model id goes through AI Gateway, which authenticates with
 * AI_GATEWAY_API_KEY or the Vercel OIDC token, read from the environment.
 */

export type ModelRole = "generate" | "plan" | "review" | "learn";

export interface ResolvedModel {
  readonly model: LanguageModel;
  /** The setting's value, recorded with what the model produced. */
  readonly id: string;
}

export function modelFor(role: ModelRole, settings: PrototypesSettings = getConfig().prototypes): ResolvedModel {
  const id = settings.models[role];
  return { model: id === "mock" ? mockModel(role) : id, id };
}

/** Gateway options for every call: zero data retention unless the setting turns it off (proposal, "Data handling"). */
export function gatewayOptions(settings: PrototypesSettings = getConfig().prototypes): { gateway: { zeroDataRetention: boolean } } {
  return { gateway: { zeroDataRetention: settings.zeroDataRetention } };
}

/**
 * Whether generation can run here (availability spec, "Generation needs a
 * configured model credential"): every model is the mock, or an AI Gateway
 * credential is in the environment.
 */
export function generationConfigured(settings: PrototypesSettings = getConfig().prototypes, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (Object.values(settings.models).every((id) => id === "mock")) return true;
  // On Vercel, functions get their OIDC token with each request rather than in the environment.
  if (env.VERCEL === "1") return true;
  return GATEWAY_CREDENTIALS.some((key) => Boolean(env[key]?.trim()));
}
