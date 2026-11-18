import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { validateStandard } from "@/lib/standards/validate";
import { sampleStandard } from "../support/standards";

const control = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({ key: "has-ci", title: "Runs CI", rationale: "Automated verification", severity: "high", subject: "repository", applicability: { op: "always" }, condition: { op: "exists", selector: "repository.ci_systems" }, guidance: null, ...overrides }) as JsonObject;
const standard = (...controls: JsonObject[]): JsonObject => ({ ...sampleStandard(), controls });
const withCondition = (condition: JsonValue) => standard(control({ condition }));

describe("draft validation", () => {
  it("reports every problem at once, each addressed to its Control and field", () => {
    const issues = validateStandard(
      standard(
        control({ key: "Bad Key", title: "", severity: "urgent" }),
        control({ key: "second", subject: "workspace", rationale: "" }),
        control({ key: "second", condition: { op: "equals", selector: "repository.submodule_count", value: -1 } }),
      ),
      { metadata: { name: " ", purpose: "" } },
    );

    expect(issues).toEqual([
      { field: "name", message: "Enter a name" },
      { field: "purpose", message: "Describe the Standard's purpose" },
      { field: "controls[0].key", message: expect.stringContaining("lowercase letters") },
      { field: "controls[0].title", message: "Enter a title" },
      { field: "controls[0].severity", message: "Choose a severity: critical, high, medium, low, info" },
      { field: "controls[1].rationale", message: "Explain the rationale" },
      { field: "controls[1].subject", message: "Choose a subject: repository or relationship_map" },
      { field: "controls[2].condition.value", message: "Enter a whole number of zero or more" },
      { field: "controls[2].key", message: "Control 2 already uses the key second" },
    ]);
  });

  it("requires at least one Control", () => {
    expect(validateStandard(standard())).toEqual([{ field: "controls", message: "Add at least one Control" }]);
  });

  it("rejects a reference to a field outside the registry, or outside the Control's scope", () => {
    expect(validateStandard(withCondition({ op: "exists", selector: "repository.secret_values" }))).toEqual([{ field: "controls[0].condition.selector", message: 'Unknown field "repository.secret_values"' }]);
    // A Service Dependency field is readable only inside a quantifier over Service Dependencies.
    expect(validateStandard(withCondition({ op: "exists", selector: "service.has_contract" }))).toEqual([{ field: "controls[0].condition.selector", message: "Contract evidence cannot be read in this part of the Control" }]);
    expect(validateStandard(withCondition({ op: "some", collection: "edges", condition: { op: "always" } }))).toEqual([{ field: "controls[0].condition.collection", message: "Relationships cannot be used in this part of the Control" }]);
  });

  it.each<[string, JsonValue]>([
    ["a script", { op: "script", source: "process.exit(1)" }],
    ["an eval node", { op: "eval", code: "1 + 1" }],
    ["a regular expression", { op: "matches", selector: "repository.languages", pattern: "^Type.*" }],
    ["a plugin", { op: "plugin", name: "custom-check" }],
    ["a node without an operator", { selector: "repository.languages" }],
  ])("rejects %s without executing it", (_name, condition) => {
    const issues = validateStandard(withCondition(condition));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "controls[0].condition.op", message: expect.stringContaining("Unsupported operator") });
  });

  it("rejects unsupported fields on any node", () => {
    expect(validateStandard(withCondition({ op: "exists", selector: "repository.ci_systems", code: "fetch('/steal')" }))).toEqual([{ field: "controls[0].condition.code", message: 'Unsupported field "code"' }]);
    expect(validateStandard(standard(control({ script: "rm -rf /" })))).toEqual([{ field: "controls[0].script", message: 'Unsupported field "script"' }]);
  });

  it.each<[string, JsonValue, string, string]>([
    ["an operator the type does not support", { op: "compare", selector: "repository.languages", comparator: "gt", value: 1 }, "controls[0].condition.op", "Languages does not support compare; use exists, contains"],
    [
      "a value outside a closed vocabulary",
      { op: "every", collection: "service_dependencies", condition: { op: "in", selector: "service.endpoint_derivation", values: ["hardcoded"] } },
      "controls[0].condition.condition.values[0]",
      '"hardcoded" is not an allowed endpoint derivation; choose literal, relative, configured, host_provided',
    ],
    ["an invalid version range", { op: "semver_satisfies", selector: "repository.node_range", range: "latest-ish" }, "controls[0].condition.range", "Enter a semantic version range of at most 100 characters, such as >=18.0.0"],
    ["a missing parameter", { op: "exists", selector: "repository.resolved_version" }, "controls[0].condition.parameter", "Enter the package"],
    ["an unexpected parameter", { op: "exists", selector: "repository.ci_systems", parameter: "github" }, "controls[0].condition.parameter", "CI systems takes no parameter"],
    ["a boolean compared with text", { op: "every", collection: "service_dependencies", condition: { op: "equals", selector: "service.has_contract", value: "yes" } }, "controls[0].condition.condition.value", "Choose true or false"],
    ["an unknown comparator", { op: "count", collection: "service_dependencies", comparator: "between", value: 2 }, "controls[0].condition.comparator", "Choose a comparison: eq, lt, lte, gt, gte"],
    ["an empty group", { op: "all", items: [] }, "controls[0].condition.items", "Add at least one condition"],
  ])("rejects %s", (_name, condition, field, message) => {
    expect(validateStandard(withCondition(condition))).toEqual([{ field, message }]);
  });

  it("requires a declared, supported schema version for each Control's subject", () => {
    const relationship = control({ key: "coverage", subject: "relationship_map", condition: { op: "equals", selector: "map.coverage_complete", value: true } });
    expect(validateStandard({ ...standard(relationship), input_schemas: { repository_profile: [1], relationship_map: [] } })).toEqual([
      { field: "controls[0].subject", message: "Declare a supported relationship_map version to evaluate a Relationship Map Control" },
    ]);
    expect(validateStandard({ ...standard(control()), input_schemas: { repository_profile: [3] } })).toEqual([
      { field: "input_schemas.repository_profile", message: "Version 3 of repository_profile is not supported; supported versions are 1, 2" },
      { field: "controls[0].subject", message: "Declare a supported repository_profile version to evaluate a repository Control" },
    ]);
  });

  it("rejects a document with the wrong schema or version", () => {
    expect(validateStandard({ ...sampleStandard(), schema: "fabricate.finding", schema_version: 3 })).toEqual([
      { field: "document.schema", message: "The document must declare schema fabricate.standard" },
      { field: "document.schema_version", message: "Standard document version 3 is not supported" },
    ]);
  });
});
