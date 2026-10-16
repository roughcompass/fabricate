import type { JsonValue } from "@repo-facts/contract";
import type { Fact, FactDocument } from "@/lib/profiles/states";
import type { RenderingMode } from "./vocabulary";

/*
 * How DE Web will render an Application, determined from its Profile
 * (rendering-assessment spec, "The determination follows fixed rules";
 * design decision 7). It's a pure function of the fact document, so it's
 * tested against fixture Profiles and can be derived again. The rules, in
 * order:
 * 1. Module Federation, when a Module Federation build exposes a module.
 * 2. ESM, when the repository is a single-spa application, which is what its
 *    exported bootstrap, mount, and unmount lifecycles make it.
 * 3. iframe, when a web front-end framework is found.
 * 4. Undetermined otherwise.
 * A deciding fact the Profile marks conflicting, or can't read, stops the
 * rules at Undetermined with its candidates: no lower rule decides instead.
 */

export const RENDERING_RULES = ["module-federation-exposes", "single-spa-application", "web-framework", "none"] as const;
export type RenderingRule = (typeof RENDERING_RULES)[number];

export const RENDERING_RULE_LABELS: Record<RenderingRule, string> = {
  "module-federation-exposes": "A Module Federation build exposes a module",
  "single-spa-application": "The repository is a single-spa application",
  "web-framework": "A web front-end framework, with no composition that decides first",
  none: "No rule applied",
};

/** The frameworks repo-facts reports that build a web front end; the server ones it also reports, such as Express, don't. */
export const WEB_FRAMEWORKS = ["react", "next", "remix", "gatsby", "preact", "vue", "nuxt", "angular", "svelte", "sveltekit", "solid", "lit", "astro", "ember"] as const;

/** Where a fact's evidence is: its file, and its lines or the pointer into structured data. */
export interface EvidenceLocation {
  id: string;
  path: string | null;
  lines: { start: number; end: number } | null;
  pointer: string | null;
}

/** A fact the determination read, with what it says and where. */
export interface DeterminationFact {
  rule: RenderingRule;
  category: string;
  key: string;
  state: string;
  /** What the fact says, as people read it: "Module Federation build mfPayees exposes ./App". */
  summary: string;
  evidence: EvidenceLocation[];
}

/** A value a conflicting or unreadable deciding fact could have, which is why the rules stopped. */
export interface DeterminationCandidate {
  summary: string;
  evidence: EvidenceLocation[];
}

export interface Determination {
  mode: RenderingMode;
  rule: RenderingRule;
  /** Why it's Undetermined, when it is. */
  reason: string | null;
  /** The facts that satisfied the deciding rule. */
  deciding: DeterminationFact[];
  /** The facts that would have matched a lower rule. */
  alsoObserved: DeterminationFact[];
  /** For Undetermined from a conflicting or unreadable fact: each value it could have. */
  candidates: DeterminationCandidate[];
  profile: string;
  assessment: string;
}

type Match = { kind: "match"; facts: DeterminationFact[] } | { kind: "blocked"; reason: string; candidates: DeterminationCandidate[]; facts: DeterminationFact[] } | { kind: "none" };

const record = (value: JsonValue | undefined): Record<string, JsonValue> | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? value : null);
const literal = (value: JsonValue | undefined): string | null => {
  const entry = record(value);
  return typeof value === "string" ? value : entry?.kind === "literal" && typeof entry.value === "string" ? entry.value : null;
};

function evidenceOf(document: FactDocument, ids: readonly string[]): EvidenceLocation[] {
  return ids.map((id) => {
    const entry = record(document.evidence[id]);
    const location = record(entry?.location);
    const lines = location?.kind === "lines" && typeof location.start === "number" ? { start: location.start, end: typeof location.end === "number" ? location.end : location.start } : null;
    return { id, path: typeof entry?.path === "string" ? entry.path : null, lines, pointer: location?.kind === "pointer" && typeof location.pointer === "string" ? location.pointer : null };
  });
}

const factsIn = (document: FactDocument, category: string): Fact[] => (Object.hasOwn(document.categories, category) ? document.categories[category]!.facts : []);
const settled = (fact: Fact) => fact.state === "observed" || fact.state === "inferred";
const describe = (document: FactDocument, rule: RenderingRule, category: string, fact: Fact, summary: string): DeterminationFact => ({ rule, category, key: fact.key, state: fact.state, summary, evidence: evidenceOf(document, fact.evidence) });

/** A Module Federation build's exposed modules, and whether more may come from code the Profile couldn't read. */
function exposesOf(value: JsonValue | undefined): { modules: string[]; unreadable: boolean } {
  const entries = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return { modules: entries.filter((entry): entry is string => typeof entry === "string"), unreadable: entries.some((entry) => typeof entry !== "string") };
}

const federationName = (value: Record<string, JsonValue>) => literal(value.name) ?? "without a name";

function moduleFederation(document: FactDocument): Match {
  const facts = factsIn(document, "composition").filter((fact) => fact.key.startsWith("module-federation:"));
  const conflicting = facts.find((fact) => !settled(fact));
  if (conflicting) {
    const candidates = (conflicting.candidates ?? []).map((candidate) => {
      const value = record(candidate.value);
      const exposes = exposesOf(value?.exposes).modules;
      return { summary: `Module Federation build ${value ? federationName(value) : "unknown"}${exposes.length ? ` exposing ${exposes.join(", ")}` : " exposing nothing"}`, evidence: evidenceOf(document, candidate.evidence) };
    });
    return { kind: "blocked", reason: `The Profile's Module Federation configuration is ${conflicting.state === "conflicting" ? "conflicting" : "unknown"}, so it can't decide whether a module is exposed`, candidates, facts: [describe(document, "module-federation-exposes", "composition", conflicting, "Module Federation configuration")] };
  }
  const exposing: DeterminationFact[] = [];
  for (const fact of facts) {
    const value = record(fact.value);
    if (value?.mechanism !== "module-federation") continue;
    const exposes = exposesOf(value.exposes);
    if (exposes.modules.length) exposing.push(describe(document, "module-federation-exposes", "composition", fact, `Module Federation build ${federationName(value)} exposes ${exposes.modules.join(", ")}`));
    else if (exposes.unreadable) {
      return { kind: "blocked", reason: `Module Federation build ${federationName(value)} builds its exposed modules in code the Profile couldn't read`, candidates: [{ summary: `Module Federation build ${federationName(value)}`, evidence: evidenceOf(document, fact.evidence) }], facts: [describe(document, "module-federation-exposes", "composition", fact, `Module Federation build ${federationName(value)}`)] };
    }
  }
  return exposing.length ? { kind: "match", facts: exposing } : { kind: "none" };
}

function singleSpa(document: FactDocument): Match {
  const facts = factsIn(document, "composition").filter((fact) => fact.key === "single-spa:application");
  const unsettled = facts.find((fact) => !settled(fact));
  if (unsettled) {
    return { kind: "blocked", reason: "The Profile's single-spa application fact is conflicting, so it can't decide whether the repository is a single-spa application", candidates: (unsettled.candidates ?? []).map((candidate) => ({ summary: "single-spa application", evidence: evidenceOf(document, candidate.evidence) })), facts: [describe(document, "single-spa-application", "composition", unsettled, "single-spa application")] };
  }
  const matching = facts.filter((fact) => record(fact.value)?.role === "application");
  return matching.length ? { kind: "match", facts: matching.map((fact) => describe(document, "single-spa-application", "composition", fact, "Exports single-spa lifecycles: bootstrap, mount, and unmount")) } : { kind: "none" };
}

function webFramework(document: FactDocument): Match {
  const facts = factsIn(document, "frameworks").filter((fact) => {
    const id = record(fact.value)?.id;
    return typeof id === "string" && (WEB_FRAMEWORKS as readonly string[]).includes(id);
  });
  const settledFacts = facts.filter(settled);
  return settledFacts.length ? { kind: "match", facts: settledFacts.map((fact) => describe(document, "web-framework", "frameworks", fact, `Uses ${String(record(fact.value)?.label ?? record(fact.value)?.id)}`)) } : { kind: "none" };
}

const RULES: [RenderingRule, Exclude<RenderingMode, "undetermined">, (document: FactDocument) => Match][] = [
  ["module-federation-exposes", "module_federation_2", moduleFederation],
  ["single-spa-application", "esm", singleSpa],
  ["web-framework", "iframe", webFramework],
];

/** The rendering mode +document+ determines, with its evidence, for the Run +assessment+ that produced Profile +profile+. */
export function determineRendering(document: FactDocument, source: { profile: string; assessment: string }): Determination {
  const results = RULES.map(([rule, mode, apply]) => ({ rule, mode, match: apply(document) }));
  const decidedAt = results.findIndex((result) => result.match.kind !== "none");
  const lower = (from: number) => results.slice(from + 1).flatMap((result) => (result.match.kind === "match" ? result.match.facts : []));
  if (decidedAt === -1) {
    return { mode: "undetermined", rule: "none", reason: "No web front end was found: the Profile records no web framework and no composition that DE Web renders", deciding: [], alsoObserved: [], candidates: [], ...source };
  }
  const decided = results[decidedAt]!;
  if (decided.match.kind === "blocked") {
    return { mode: "undetermined", rule: decided.rule, reason: decided.match.reason, deciding: decided.match.facts, alsoObserved: lower(decidedAt), candidates: decided.match.candidates, ...source };
  }
  return { mode: decided.mode, rule: decided.rule, reason: null, deciding: decided.match.kind === "match" ? decided.match.facts : [], alsoObserved: lower(decidedAt), candidates: [], ...source };
}
