import { describe, expect, it } from "vitest";
import { describeIssue, issueLocation } from "@/lib/standards/issue-location";

const controls = [{ key: "has-ci" }, { key: "" }, {}];

describe("Standard issue locations", () => {
  it("names the Control by position and key, and the part in words", () => {
    expect(issueLocation("controls[0].key", controls)).toBe("Control 1 (has-ci) · Key");
    expect(issueLocation("controls[0].condition.items[1].values", controls)).toBe("Control 1 (has-ci) · Expected condition");
    expect(issueLocation("controls[0].applicability", controls)).toBe("Control 1 (has-ci) · Applies when");
  });

  it("leaves out an empty or missing key", () => {
    expect(issueLocation("controls[1].title", controls)).toBe("Control 2 · Title");
    expect(issueLocation("controls[2]", controls)).toBe("Control 3");
  });

  it("describes issues outside a Control in words", () => {
    expect(issueLocation("controls", controls)).toBe("Controls");
    expect(issueLocation("input_schemas.repository_profile", controls)).toBe("Input schemas repository profile");
  });

  it("adds the message for lists without the fields", () => {
    expect(describeIssue({ field: "controls[0].key", message: "Use lowercase letters, digits, and hyphens" }, controls)).toBe("Control 1 (has-ci) · Key: Use lowercase letters, digits, and hyphens");
    expect(describeIssue({ field: "controls", message: "Add at least one Control" }, [])).toBe("Controls: Add at least one Control");
  });
});
