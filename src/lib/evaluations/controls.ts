import { type JsonObject, type JsonValue, compareCodeUnits } from "@repo-facts/contract";
import { DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import type { MapDocument } from "@/lib/relationships/schema";
import { mapContext, repositoryContext } from "./contexts";
import { type Context, type TraceNode, evaluate, traceEvidence, unknownCauses } from "./interpreter";
import { asObject } from "@/lib/json";

/**
 * Applies one Release's Controls to an Assessment's immutable results.
 *
 * A repository Control produces one Finding per Assessment target; a target
 * without a Profile is read as unknown, so it is Indeterminate rather than
 * silently skipped. A relationship Control produces one Finding against the
 * Relationship Map. Applicability false is Not applicable and unknown is
 * Indeterminate; a condition true is Meets, false is Gap, and unknown is
 * Indeterminate. Each Finding carries both traces, the causes of any
 * uncertainty, the evidence records it cites, and the Release's guidance as a
 * diagnostic suggestion.
 */

export const EVALUATOR_VERSION = "1";

export type Outcome = "meets" | "gap" | "indeterminate" | "not_applicable";

export interface TargetInput {
  public_id: string;
  source: { public_id: string; name: string };
  state: string;
  failure: string | null;
  profile: { public_id: string; digest: string; commit: string; factDocument: JsonObject } | null;
}

export interface EvaluationInputs {
  targets: readonly TargetInput[];
  map: { public_id: string; digest: string; document: MapDocument } | null;
}

export interface ReleaseInput {
  public_id: string;
  digest: string;
  version: number;
  standard: string;
  document: JsonObject;
}

/** Every Finding document for one Release, in Control then subject order. */
export function evaluateReleaseControls(release: ReleaseInput, inputs: EvaluationInputs): JsonObject[] {
  const findings: JsonObject[] = [];
  const controls = (Array.isArray(release.document.controls) ? release.document.controls : []).map(asObject);
  for (const control of controls) {
    if (control.subject === "relationship_map") {
      findings.push(relationshipFinding(release, control, inputs.map));
      continue;
    }
    for (const target of inputs.targets) findings.push(repositoryFinding(release, control, target));
  }
  return findings;
}

function repositoryFinding(release: ReleaseInput, control: JsonObject, target: TargetInput): JsonObject {
  const missing = `${target.source.name} has no Profile: its assessment ${target.state === "canceled" ? "was canceled" : target.state === "failed" ? `failed${target.failure ? ` (${target.failure})` : ""}` : "did not produce one"}`;
  const context = repositoryContext(target.profile?.factDocument ?? null, missing);
  const subject = {
    type: "repository",
    key: target.source.public_id,
    name: target.source.name,
    target: target.public_id,
    commit: target.profile?.commit ?? null,
    profile: target.profile ? { public_id: target.profile.public_id, digest: target.profile.digest } : null,
  };
  return finding(release, control, subject, context, asObject(target.profile?.factDocument.evidence));
}

function relationshipFinding(release: ReleaseInput, control: JsonObject, map: EvaluationInputs["map"]): JsonObject {
  const context: Context = map ? mapContext(map.document) : repositoryContext(null, "The Run has no Relationship Map");
  const subject = {
    type: "relationship_map",
    key: "relationship_map",
    name: "Relationship Map",
    map: map ? { public_id: map.public_id, digest: map.digest, coverage_complete: map.document.coverage.complete, coverage_gaps: map.document.coverage.gaps.length } : null,
  };
  return finding(release, control, subject, { ...context, scope: "relationship_map" }, map ? (map.document.evidence as JsonObject) : {});
}

function finding(release: ReleaseInput, control: JsonObject, subject: JsonObject, context: Context, evidenceRecords: JsonObject): JsonObject {
  const applicability = evaluate(control.applicability ?? null, context);
  let condition: TraceNode | null = null;
  let outcome: Outcome;
  if (applicability.result === "false") outcome = "not_applicable";
  else if (applicability.result === "unknown") outcome = "indeterminate";
  else {
    condition = evaluate(control.condition ?? null, context);
    outcome = condition.result === "true" ? "meets" : condition.result === "false" ? "gap" : "indeterminate";
  }

  const causes = outcome === "indeterminate" ? unknownCauses(condition ?? applicability) : [];
  const cited = [...new Set([...traceEvidence(applicability), ...(condition ? traceEvidence(condition) : [])])].sort(compareCodeUnits);
  const evidence = Object.fromEntries(cited.filter((id) => evidenceRecords[id] !== undefined).map((id) => [id, evidenceRecords[id]!]));
  const guidance = typeof control.guidance === "string" && control.guidance ? { text: control.guidance, kind: "diagnostic" } : null;

  return {
    schema: DOCUMENT_SCHEMAS.finding.name,
    schema_version: 1,
    evaluator_version: EVALUATOR_VERSION,
    release: { public_id: release.public_id, digest: release.digest, standard: release.standard, version: release.version },
    control: {
      key: String(control.key),
      title: String(control.title),
      rationale: String(control.rationale),
      severity: String(control.severity),
      subject: String(control.subject),
      applicability: control.applicability ?? null,
      condition: control.condition ?? null,
    },
    subject,
    outcome,
    applicability: applicability as unknown as JsonValue,
    condition: condition as unknown as JsonValue,
    causes: causes as unknown as JsonValue,
    reasoning: reasoning(outcome, condition !== null, causes.map((cause) => cause.reason)),
    guidance,
    evidence,
  };
}

function reasoning(outcome: Outcome, applies: boolean, causes: readonly string[]): string {
  const because = causes.length ? ` ${causes.map((cause) => (/[.!?]$/.test(cause) ? cause : `${cause}.`)).join(" ")}` : "";
  switch (outcome) {
    case "meets":
      return "The Control applies, and the evidence shows the expected condition holds.";
    case "gap":
      return "The Control applies, and the evidence shows the expected condition does not hold.";
    case "not_applicable":
      return "The Control does not apply: the evidence shows its applicability condition is false.";
    case "indeterminate":
      return applies ? `The Control applies, but the evidence cannot establish whether the expected condition holds.${because}` : `The evidence cannot establish whether the Control applies.${because}`;
  }
}

