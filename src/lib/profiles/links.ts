import type { TraceNode } from "@/lib/evaluations/interpreter";
import { SELECTOR_BY_ID } from "@/lib/standards/registry";
import { type FactDocument, categoryOf } from "./states";

/**
 * The Profile category a Finding's Control reads: that of the first
 * repository selector in its condition, then in its applicability. A
 * Control that reads only Service Dependencies or the Relationship Map has none.
 */
export function findingCategory(...traces: (TraceNode | null | undefined)[]): string | null {
  const walk = (node: TraceNode | null | undefined): string | null => {
    if (!node) return null;
    const category = node.selector ? SELECTOR_BY_ID.get(node.selector)?.category : undefined;
    if (category) return category;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    for (const item of node.items ?? []) {
      const found = walk(item.where) ?? walk(item.trace);
      if (found) return found;
    }
    return null;
  };
  for (const trace of traces) {
    const found = walk(trace);
    if (found) return found;
  }
  return null;
}

/** The Profile section that cites an evidence record: the category whose facts or candidates cite it, or Service Dependencies. */
export function evidenceSection(document: FactDocument, evidenceId: string): string | null {
  for (const id of Object.keys(document.categories)) {
    const cites = categoryOf(document, id)?.facts.some((fact) => fact.evidence.includes(evidenceId) || (fact.candidates ?? []).some((candidate) => candidate.evidence.includes(evidenceId)));
    if (cites) return id;
  }
  const services = JSON.stringify(document.service_dependencies ?? []);
  return services.includes(`"${evidenceId}"`) ? "services" : null;
}
