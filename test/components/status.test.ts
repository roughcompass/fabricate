import { CATEGORY_STATES, FACT_STATES } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { diagnosticReason, hasStatus, severityLabel, severityOptions, statusOf } from "@/components/ui/status";
import { ASSESSMENT_STATES, EVALUATION_RELEASE_STATES, EVALUATION_STATES, OUTCOMES, SEVERITIES, TARGET_STATES } from "@/lib/db/schema";
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
  ])("labels every %s state explicitly, never by fallback", (_kind, states) => {
    for (const state of states) {
      const { label } = statusOf(state);
      expect(label, state).not.toContain("_");
      expect(label, state).toMatch(/^[A-Z]/);
    }
    expect(states.filter((state) => !hasStatus(state))).toEqual([]);
  });

  it("shows the canceling state while a cancellation is pending", () => {
    expect(statusOf("canceling")).toEqual({ label: "Canceling", tone: "progress" });
  });

  it("capitalizes every severity and orders the options most severe first", () => {
    for (const severity of SEVERITIES) expect(severityLabel(severity)).toMatch(/^[A-Z][a-z]+$/);
    expect(severityOptions(SEVERITIES).map((option) => option.label)).toEqual(["Critical", "High", "Medium", "Low", "Info"]);
  });

  it("humanizes values that have no mapping", () => {
    expect(statusOf("waiting_for_review")).toEqual({ label: "Waiting for review", tone: "neutral" });
    expect(diagnosticReason("brand_new_reason")).toBe("Brand new reason");
    expect(diagnosticReason("parse_failed")).toBe("Could not be parsed");
  });
});
