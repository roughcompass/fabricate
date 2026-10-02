import { describe, expect, it } from "vitest";
import type { TraceNode } from "@/lib/evaluations/interpreter";
import { evidenceSection, findingCategory } from "@/lib/profiles/links";
import type { FactDocument } from "@/lib/profiles/states";
import { factDocumentFixture } from "../../support/fact-documents";

const leaf = (selector: string): TraceNode => ({ op: "exists", result: "true", selector, evidence: [] });

describe("links from Findings and evidence into a Profile", () => {
  it("finds the category of the first repository selector a Control reads, through groups and quantifiers", () => {
    expect(findingCategory(leaf("repository.ci_systems"))).toBe("ci_systems");
    expect(findingCategory({ op: "all", result: "true", evidence: [], children: [leaf("service.key"), leaf("repository.node_range")] })).toBe("runtime_requirements");
    expect(findingCategory({ op: "every", result: "false", evidence: [], items: [{ subject: "a", included: "true", result: "false", trace: leaf("service.client") }] })).toBeNull();
    // The condition first, then the applicability.
    expect(findingCategory(leaf("service.key"), leaf("repository.declared_range"))).toBe("dependencies");
    expect(findingCategory(null, undefined)).toBeNull();
  });

  it("finds the section that cites an evidence record", () => {
    const document = factDocumentFixture("npm-workspace") as unknown as FactDocument;
    const managers = document.categories.package_managers!.facts[0]!;
    expect(evidenceSection(document, managers.evidence[0]!)).toBe("package_managers");
    // Evidence only a Service Dependency cites returns to the Service Dependencies.
    const call = "ev_0123456789abcdef01234567";
    expect(evidenceSection({ ...document, service_dependencies: [{ key: "https://api.example.test", call_sites: [call] }] }, call)).toBe("services");
    expect(evidenceSection(document, "ev_000000000000000000000000")).toBeNull();
  });
});
