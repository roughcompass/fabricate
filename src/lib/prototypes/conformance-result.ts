/**
 * A version's check at acceptance, as the confirmation step shows it
 * (template-conformance spec). Shared by the server, which computes it in
 * conformance.ts, and the client, which polls for it.
 */

export interface ReleaseResult {
  label: string;
  publicId: string;
  /** The Release's position in its Evaluation, which the Evaluation page filters Findings by. */
  position: number;
  counts: { meets: number; gap: number; indeterminate: number; not_applicable: number };
}

export interface BlockingFinding {
  release: string;
  control: string;
  outcome: "gap" | "indeterminate";
  /** What was observed against what the Control expects, when the condition compares one value. */
  observed: string | null;
  /** For an Indeterminate Finding: the evidence that was missing. */
  causes: string[];
  href: string;
}

export type Conformance =
  | { status: "not_evaluated"; reason: "no_release" }
  | { status: "running"; stage: "assessing" | "evaluating"; assessmentId: string; stalled: boolean }
  | { status: "failed"; assessmentId: string; reason: string }
  | { status: "unavailable"; assessmentId: string | null }
  | { status: "evaluated"; assessmentId: string; evaluationId: string; releases: ReleaseResult[]; blocking: BlockingFinding[] };

/** Whether a conformance result lets the visitor confirm Accept. */
export function confirmable(conformance: Conformance): boolean {
  return conformance.status === "not_evaluated" || (conformance.status === "evaluated" && conformance.blocking.length === 0);
}
