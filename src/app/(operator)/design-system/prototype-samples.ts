import type { Attempt, Audit, FitReview, GateResult } from "@/lib/prototypes/types";

/** Fictional evidence for the gallery's Checks panel specimen: a version that passed after one repair. */

const passed = (gate: GateResult["gate"]): GateResult => ({ gate, status: "passed", issues: [], warnings: [], durationMs: 40 });

const firstPass: GateResult[] = [
  passed("salt-only"),
  { gate: "typecheck", status: "failed", issues: [{ code: "TS2322", message: "Property 'size' does not exist on type 'ButtonProps'.", line: 42, symbol: "Button.size" }], warnings: [], durationMs: 310 },
  passed("salt-usage"),
  passed("build"),
];

const final: GateResult[] = [passed("salt-only"), passed("typecheck"), { ...passed("salt-usage"), warnings: [{ code: "salt-usage/lab", message: "Tokenized input is a pre-release Salt component from @salt-ds/lab.", symbol: "TokenizedInput" }] }, passed("build")];

const attempts: Attempt[] = [
  { number: 1, gates: firstPass, passed: false, at: "2026-10-16T09:00:00.000Z" },
  { number: 2, gates: final, passed: true, at: "2026-10-16T09:00:40.000Z" },
];

const audit: Audit = { at: "2026-10-16T09:01:00.000Z", violations: [{ rule: "label", impact: "serious", description: "Form elements must have labels", help: "Form elements must have labels", targets: ["#payee-search"], html: ['<input id="payee-search">'] }] };

const fit: FitReview = {
  status: "reviewed",
  model: "google/gemini-3.1-pro-preview",
  average: 4.3,
  at: "2026-10-16T09:01:10.000Z",
  personas: [
    {
      personaId: "per_aaaaaaaaaaaaaaaa",
      personaName: "Maya Lindqvist",
      criteria: {
        intent: { score: 4, reason: "The queue shows what needs releasing today." },
        goals: { score: 5, reason: "Payments that need action lead." },
        constraints: { score: "unknown", reason: "The code doesn't show who prepared each payment." },
        clarity: { score: 4, reason: "Amounts carry currency codes." },
      },
      checks: [
        { check: "Cut-off times are visible", score: 5, reason: "Every row shows its cut-off." },
        { check: "Four-eyes approval state is shown", score: 4, reason: "Large payments show their second approver." },
        { check: "Amounts are easy to compare", score: 4, reason: "Amounts are right-aligned." },
      ],
      strengths: [{ text: "Status pairs Salt's indicator with a label.", element: "Status column" }],
      gaps: [{ text: "Totals per cut-off aren't shown.", element: "Table", criterion: "goals" }],
    },
  ],
};

export const SAMPLE_EVIDENCE = { gates: final, attempts, firstPass, audit, renderError: null, fit } as const;
