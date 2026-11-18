import { CATEGORY_STATES, FACT_STATES } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { checkKind, dependencyKind, diagnosticReason, hasStatus, severityLabel, severityOptions, statusOf } from "@/components/ui/status";
import { ASSESSMENT_STATES, DE_CONSOLE_CONFLICT_REASONS, DE_CONSOLE_READ_STATUSES, EVALUATION_RELEASE_STATES, EVALUATION_STATES, OUTCOMES, SEVERITIES, TARGET_STATES } from "@/lib/db/schema";
import { RESOLUTION_STATES } from "@/lib/relationships/schema";

describe("status registry", () => {
  it.each([
    ["Assessment", ASSESSMENT_STATES],
    ["target", TARGET_STATES],
    ["Evaluation", EVALUATION_STATES],
    ["pinned Release", EVALUATION_RELEASE_STATES],
    ["outcome", OUTCOMES],
    ["resolution", RESOLUTION_STATES],
    ["fact", FACT_STATES],
    ["category", CATEGORY_STATES],
    ["DE Console read", DE_CONSOLE_READ_STATUSES],
    ["DE Console conflict reason", DE_CONSOLE_CONFLICT_REASONS],
    ["Evaluation conclusion", ["gaps", "undetermined", "conforms", "not_applicable", "not_evaluated"]],
  ])("labels every %s state explicitly, never by fallback", (_kind, states) => {
    for (const state of states) {
      const { label } = statusOf(state);
      expect(label, state).not.toContain("_");
      expect(label, state).toMatch(/^[A-Z]/);
    }
    expect(states.filter((state) => !hasStatus(state))).toEqual([]);
  });

  it("names why a DE Console entry is in conflict in words", () => {
    expect(statusOf("duplicate_in_export").label).toBe("Listed twice in the export");
    expect(statusOf("several_applications").label).toBe("Matches several applications");
    expect(statusOf("not_evaluated")).toEqual({ label: "Not evaluated", tone: "neutral", indicator: "dash" });
  });

  it("shows the canceling state while a cancellation is pending", () => {
    expect(statusOf("canceling")).toEqual({ label: "Canceling", tone: "progress", indicator: "dot" });
  });

  it("gives each state with no value its own neutral indicator", () => {
    expect(statusOf("unknown")).toEqual({ label: "Unknown", tone: "neutral", indicator: "ring" });
    expect(statusOf("absent")).toEqual({ label: "None detected", tone: "neutral", indicator: "dot" });
    expect(statusOf("not_covered")).toEqual({ label: "Not covered", tone: "neutral", indicator: "dash" });
  });

  it("labels dependency kinds by manifest field, and check kinds by what they check", () => {
    expect(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].map(dependencyKind)).toEqual(["Production", "Development", "Peer", "Optional"]);
    expect(["e2e", "test", "lint", "typecheck", "build", "format", "audit"].map(checkKind)).toEqual(["End-to-end", "Test", "Lint", "Typecheck", "Build", "Format", "Audit"]);
    expect(dependencyKind("bundledDependencies")).toBe("BundledDependencies");
  });

  it("capitalizes every severity and orders the options most severe first", () => {
    for (const severity of SEVERITIES) expect(severityLabel(severity)).toMatch(/^[A-Z][a-z]+$/);
    expect(severityOptions(SEVERITIES).map((option) => option.label)).toEqual(["Critical", "High", "Medium", "Low", "Info"]);
  });

  it("humanizes values that have no mapping", () => {
    expect(statusOf("waiting_for_review")).toEqual({ label: "Waiting for review", tone: "neutral", indicator: "dot" });
    expect(diagnosticReason("brand_new_reason")).toBe("Brand new reason");
    expect(diagnosticReason("parse_failed")).toBe("Could not be parsed");
  });
});
