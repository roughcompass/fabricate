import { describe, expect, it } from "vitest";
import { FAILURE_SENTENCES, failureKind, failureSentence } from "@/lib/runs/failures";

// page-patterns spec, content standard "Failures": every failure is described
// by what happened and what to do next, never by its code alone.
describe("failure sentences", () => {
  it.each(Object.entries(FAILURE_SENTENCES))("says what %s means and what to do, in words", (code, sentence) => {
    expect(sentence, code).toMatch(/^[A-Z].*\.\s[A-Z].*\.$/);
    expect(sentence, code).not.toMatch(/_|\bworker\b|\b(src|asm|svy|ini)_/);
  });

  it("tells a Run that Bitbucket refused to add a Bitbucket token in Admin (Failed Run)", () => {
    expect(failureSentence("authentication_failed", "Could not read the repository")).toContain("In Admin, save a Bitbucket token for its server with read access, or delete and replace the one it refused");
  });

  it("reads a survey that needs a newer Surveyor release as a mismatch, naming both releases and no public ID (Version that failed on a Surveyor release mismatch)", () => {
    const message = "Survey svy_abc123def456 needs Surveyor 0.8.0 with its recorded configuration and Profile version 3, but this worker runs Surveyor 0.7.0";
    expect(failureKind("analysis_failed", message)).toBe("surveyor_mismatch");
    const sentence = failureSentence("analysis_failed", message);
    expect(sentence).toBe("This version needs Surveyor 0.8.0, a newer release than the installed 0.7.0. Upgrade the Frontend Registry, or re-profile the Repository to survey it with 0.7.0.");
    expect(failureSentence("analysis_failed", message.replace("0.8.0", "0.6.0"))).toContain("requested with Surveyor 0.6.0, not the installed 0.7.0");
  });

  it("reads another analysis failure as such, and an unknown code as an unexpected failure", () => {
    expect(failureKind("analysis_failed", "Parser crashed")).toBe("analysis_failed");
    expect(failureKind("something_new", null)).toBe("unexpected");
    expect(failureKind(null)).toBeNull();
  });
});
