import type { EdgeKind } from "@/lib/db/schema";
import { compare } from "./placement";

/*
 * What a diagram draws (design decision 5). Boxes are repositories, each in a
 * group. Only architecture between groups becomes an arrow; the edges
 * between one pair of repositories merge into one arrow that keeps every
 * signal. A relationship inside a group folds into its internal count, a
 * repository's relationship to itself becomes a badge, and a reference with
 * no matched endpoint becomes a stub on the repository that declared it.
 * Dependencies on third-party packages are counted, never drawn.
 */

export interface DiagramEdge {
  edgeId: string;
  from: string;
  to: string | null;
  type: string;
  state: string;
  rule: string;
  basis: string;
  /** Why the resolver couldn't match the reference, for an unmatched edge. */
  reason?: string | null;
  evidence: readonly string[];
  kind: EdgeKind;
  referenceIdentifier: Readonly<Record<string, string>>;
  candidates: readonly string[];
}

export interface Signal {
  edgeId: string;
  type: string;
  rule: string;
  basis: string;
  evidence: readonly string[];
}

interface Arrow {
  from: string;
  to: string;
  signals: Signal[];
}

interface Badge {
  box: string;
  signals: Signal[];
}

interface Stub {
  box: string;
  edgeId: string;
  type: string;
  state: "unresolved" | "ambiguous" | "out_of_scope";
  label: string;
  candidates: string[];
}

export interface DiagramModel {
  arrows: Arrow[];
  badges: Badge[];
  stubs: Stub[];
  /** Distinct repository relationships inside each group, by group key. */
  internal: Map<string, number>;
  /** Third-party packages the boxes depend on, which the drawing leaves out. */
  thirdPartyPackages: string[];
}

/**
 * +groupOf+ maps each box's node ID to its group key. +labelOf+ names any node,
 * for stubs that point outside the Run.
 */
export function diagramModel(groupOf: ReadonlyMap<string, string>, edges: readonly DiagramEdge[], labelOf: (nodeId: string) => string): DiagramModel {
  const arrows = new Map<string, Arrow>();
  const badges = new Map<string, Badge>();
  const stubs: Stub[] = [];
  const internal = new Map<string, Set<string>>();
  const thirdParty = new Set<string>();

  for (const edge of [...edges].sort((a, b) => compare(a.edgeId, b.edgeId))) {
    const group = groupOf.get(edge.from);
    if (group === undefined) continue;
    const signal: Signal = { edgeId: edge.edgeId, type: edge.type, rule: edge.rule, basis: edge.basis, evidence: edge.evidence };

    if (edge.kind === "own_package") continue;
    if (edge.kind === "third_party") {
      thirdParty.add(edge.referenceIdentifier.name ?? Object.values(edge.referenceIdentifier).join(" "));
      continue;
    }
    if (edge.kind === "self") {
      const badge = badges.get(edge.from) ?? { box: edge.from, signals: [] };
      badge.signals.push(signal);
      badges.set(edge.from, badge);
      continue;
    }
    if (edge.state === "unresolved" || edge.state === "ambiguous" || edge.state === "out_of_scope") {
      stubs.push({ box: edge.from, edgeId: edge.edgeId, type: edge.type, state: edge.state, label: stubLabel(edge, labelOf), candidates: edge.candidates.map(labelOf) });
      continue;
    }
    if (edge.to === null) continue;
    const target = groupOf.get(edge.to);
    if (target === undefined) continue;
    if (target === group) {
      internal.set(group, (internal.get(group) ?? new Set()).add(`${edge.from}\u0000${edge.to}`));
      continue;
    }
    const key = `${edge.from}\u0000${edge.to}`;
    const arrow = arrows.get(key) ?? { from: edge.from, to: edge.to, signals: [] };
    arrow.signals.push(signal);
    arrows.set(key, arrow);
  }

  return {
    arrows: [...arrows.values()].sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    badges: [...badges.values()].sort((a, b) => compare(a.box, b.box)),
    stubs: stubs.sort((a, b) => compare(a.box, b.box) || compare(a.label, b.label) || compare(a.edgeId, b.edgeId)),
    internal: new Map([...internal].map(([key, pairs]) => [key, pairs.size])),
    thirdPartyPackages: [...thirdParty].sort(compare),
  };
}

function stubLabel(edge: DiagramEdge, labelOf: (nodeId: string) => string): string {
  if (edge.state === "ambiguous") return `One of ${edge.candidates.map(labelOf).join(", ")}`;
  if (edge.state === "out_of_scope" && edge.to) return labelOf(edge.to);
  const values = Object.values(edge.referenceIdentifier);
  return values.length > 0 ? values.join(" ") : edge.type;
}
