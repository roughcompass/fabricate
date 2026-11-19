import type { JsonObject } from "@repo-facts/contract";

/** A Standard document around +controls+, reading Repository Profile +profileVersions+ (version 1 by default) and Relationship Map version 1. */
export function standardDocument(controls: readonly JsonObject[], options: { profileVersions?: readonly number[] } = {}): JsonObject {
  return { schema: "fabricate.standard", schema_version: 1, input_schemas: { repository_profile: [...(options.profileVersions ?? [1])], relationship_map: [1] }, controls: [...controls] };
}

/** A valid Control with +fields+ over its defaults: titled by its key, of medium severity, applying to every repository, expecting CI, and giving no guidance. */
export function control(fields: JsonObject = {}): JsonObject {
  const key = typeof fields.key === "string" ? fields.key : "has-ci";
  return { key, title: key, rationale: "Test", severity: "medium", subject: "repository", applicability: { op: "always" }, condition: { op: "exists", selector: "repository.ci_systems" }, guidance: null, ...fields };
}

/** A valid Standard that uses every expression operator, for tests. */
export function sampleStandard(): JsonObject {
  return standardDocument([
    {
      key: "has-ci",
      title: "Runs continuous integration",
      rationale: "Changes need automated verification before they merge.",
      severity: "high",
      subject: "repository",
      applicability: { op: "always" },
      condition: { op: "exists", selector: "repository.ci_systems" },
      guidance: "Add a GitHub Actions workflow that runs the tests.",
    },
    {
      key: "pnpm-only",
      title: "Uses pnpm alone",
      rationale: "One package manager keeps lockfiles reproducible.",
      severity: "medium",
      subject: "repository",
      applicability: { op: "contains", selector: "repository.languages", mode: "any", values: ["TypeScript", "JavaScript"] },
      condition: {
        op: "all",
        items: [
          { op: "contains", selector: "repository.package_managers", mode: "all", values: ["pnpm"] },
          { op: "not", item: { op: "contains", selector: "repository.package_managers", mode: "any", values: ["npm", "yarn"] } },
        ],
      },
      guidance: null,
    },
    {
      key: "node-current",
      title: "Requires a current Node.js",
      rationale: "Older Node.js releases no longer receive security fixes.",
      severity: "high",
      subject: "repository",
      applicability: { op: "exists", selector: "repository.node_range" },
      condition: { op: "semver_satisfies", selector: "repository.node_range", range: ">=20.0.0" },
      guidance: null,
    },
    {
      key: "react-18",
      title: "Resolves React 18 or newer",
      rationale: "The shared component library requires React 18.",
      severity: "medium",
      subject: "repository",
      applicability: { op: "exists", selector: "repository.declared_range", parameter: "react" },
      condition: { op: "semver_satisfies", selector: "repository.resolved_version", parameter: "react", range: ">=18.0.0" },
      guidance: null,
    },
    {
      key: "no-submodules",
      title: "Declares no submodules",
      rationale: "Submodules complicate reproducible checkouts.",
      severity: "low",
      subject: "repository",
      applicability: { op: "always" },
      condition: { op: "compare", selector: "repository.submodule_count", comparator: "eq", value: 0 },
      guidance: null,
    },
    {
      key: "services-configurable",
      title: "Service destinations are configurable or contracted",
      rationale: "Migrations need to point services at test doubles without code changes.",
      severity: "critical",
      subject: "repository",
      applicability: { op: "some", collection: "service_dependencies", condition: { op: "always" } },
      condition: {
        op: "every",
        collection: "service_dependencies",
        where: { op: "in", selector: "service.protocol", values: ["http", "graphql"] },
        condition: {
          op: "any",
          items: [
            { op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided"] },
            { op: "equals", selector: "service.has_contract", value: true },
          ],
        },
      },
      guidance: "Read the base URL from configuration, or commit the service's OpenAPI document.",
    },
    {
      key: "composition-resolved",
      title: "Every composition relationship resolves",
      rationale: "A host must reach each application it composes.",
      severity: "high",
      subject: "relationship_map",
      applicability: { op: "always" },
      condition: {
        op: "count",
        collection: "edges",
        where: { op: "all", items: [{ op: "equals", selector: "edge.type", value: "composition" }, { op: "in", selector: "edge.state", values: ["ambiguous", "unresolved"] }] },
        comparator: "eq",
        value: 0,
      },
      guidance: null,
    },
    {
      key: "full-coverage",
      title: "Every repository was assessed",
      rationale: "Relationships from a missing repository are unknown.",
      severity: "info",
      subject: "relationship_map",
      applicability: { op: "always" },
      condition: { op: "equals", selector: "map.coverage_complete", value: true },
      guidance: null,
    },
  ]);
}
