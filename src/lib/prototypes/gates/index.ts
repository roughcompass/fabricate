import { createHash } from "node:crypto";
import type { GateExemption, GateIssue, GateResult } from "../types";
import { buildGate } from "./build";
import type { PrototypeSource } from "./common";
import { saltOnlyGate } from "./salt-only";
import { saltUsageGate } from "./salt-usage";
import { typecheckGate } from "./typecheck";

/**
 * The four deterministic gates every version passes before it is shown
 * (design.md, decision 7; quality-checks spec, "Deterministic gates run on
 * every version"). They run in-process and never execute generated code.
 */

export { ALLOWED_IMPORTS, PORTAL_MODULE, PROTOTYPE_GLOBAL, type PrototypeSource, portalAllowed } from "./common";
export { buildGate, type BuildOutput } from "./build";
export { saltOnlyGate } from "./salt-only";
export { saltUsageGate, type SaltUsageTools } from "./salt-usage";
export { typecheckGate } from "./typecheck";

export interface GateRun {
  readonly results: readonly GateResult[];
  readonly passed: boolean;
  /** The build gate's browser module, when it passed. */
  readonly compiled: string | null;
  readonly signatures: readonly string[];
}

/**
 * Moves each issue a planted defect may cause out of a result's issues, naming
 * the rule that allowed it, so a planted version passes on everything else
 * and only there.
 */
export function exempt(result: GateResult, exemptions: readonly GateExemption[]): GateResult {
  const allowed = (issue: GateIssue) => exemptions.find((exemption) => exemption.codes.includes(issue.code));
  const exempted = result.issues.flatMap((issue) => {
    const exemption = allowed(issue);
    return exemption ? [{ rule: exemption.rule, issue }] : [];
  });
  if (exempted.length === 0) return result;
  const issues = result.issues.filter((issue) => !allowed(issue));
  return { ...result, issues, exempted, status: issues.length > 0 ? "failed" : "passed" };
}

/** Runs every gate, without stopping at the first failure, so a repair sees all of them. A planted version's exemptions apply to every gate. */
export async function runGates(source: PrototypeSource, options: { readonly exemptions?: readonly GateExemption[] } = {}): Promise<GateRun> {
  const saltOnly = saltOnlyGate(source);
  const typecheck = typecheckGate(source);
  const saltUsage = await saltUsageGate(source);
  const build = buildGate(source);
  const exemptions = options.exemptions ?? [];
  const results = [saltOnly, typecheck, saltUsage, build.result].map((entry) => exempt(entry, exemptions));
  return {
    results,
    passed: results.every((entry) => entry.status !== "failed"),
    compiled: build.result.status === "passed" ? build.compiled : null,
    signatures: failureSignatures(results),
  };
}

/**
 * What identifies a recurring failure across repair attempts (design.md,
 * decision 7): gate, code, and symbol, such as `typecheck:TS2322:Button.color`.
 * Lines and messages are left out, so an edit elsewhere doesn't change them.
 */
export function failureSignatures(results: readonly GateResult[]): string[] {
  const signatures = new Set<string>();
  for (const entry of results) {
    if (entry.status !== "failed") continue;
    for (const issue of entry.issues) signatures.add(`${entry.gate}:${issue.code}${issue.symbol ? `:${issue.symbol}` : ""}`);
  }
  return [...signatures].sort();
}

/**
 * The version of these gates' rules (design.md, decision 13). Bump it whenever
 * a gate's rules change, so a template version records which checks it passed.
 */
export const CHECKS_VERSION = 1;

/**
 * The SHA-256 of gate results with their timings left out and their issues
 * in a fixed order, so the same results always give the same digest.
 */
export function checkDigest(results: readonly GateResult[]): string {
  const issue = ({ code, symbol, line, message }: GateIssue) => ({ code, symbol: symbol ?? null, line: line ?? null, message });
  const order = (left: ReturnType<typeof issue>, right: ReturnType<typeof issue>) => JSON.stringify(left).localeCompare(JSON.stringify(right));
  const normalized = [...results]
    .sort((left, right) => left.gate.localeCompare(right.gate))
    .map((result) => ({ gate: result.gate, status: result.status, issues: result.issues.map(issue).sort(order), warnings: result.warnings.map(issue).sort(order) }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
