import path from "node:path";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { type EvidenceLocation, evidenceLocations } from "@/lib/profiles/evidence-locations";
// Types only: the profile view module pulls in UI components the worker must not bundle.
import type { Category, Fact, FactDocument } from "@/lib/profiles/states";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";
import { list } from "./wording";

/*
 * A commit's fact document as eligibility reads it (eligibility.ts): its
 * packages, which package owns each input, whether a package belongs to a
 * workspace, and its facts with the evidence each cites, kept to a package's
 * own where a fact is reported once for the whole repository.
 */

const WORKSPACE_INPUTS = new Set(["package.json", "pnpm-workspace.yaml"]);
/** How many paths a reason names before counting the rest. */
const NAMED = 3;

/** A fact behind a condition, with the evidence it cites. A null key is the category as a whole. */
export interface DecidingFact {
  category: string;
  key: string | null;
  state: string;
  value: JsonValue;
  evidence: EvidenceLocation[];
  candidates?: { value: JsonValue; evidence: EvidenceLocation[] }[];
}

export function manifestPath(directory: string): string {
  return directory === "." ? "package.json" : `${directory}/package.json`;
}

export interface Membership {
  /** The workspace root the package installs from, or null when it isn't a member of one. */
  root: string | null;
  unknown: string | null;
  facts: DecidingFact[];
}

export class ProfiledRepository {
  /** Every package directory, from its package.json manifest, in path order. */
  readonly packages: string[];
  private readonly owners = new Map<string, string | null>();
  private readonly memberships = new Map<string, Membership>();

  constructor(readonly document: FactDocument) {
    const manifests = new Set<string>();
    for (const fact of this.facts("package_identity")) manifests.add(manifestOfFact(fact));
    for (const fact of [...this.facts("frameworks"), ...this.facts("scripts")]) manifests.add(manifestOfFact(fact));
    this.packages = [...manifests]
      .filter((manifest) => path.posix.basename(manifest) === "package.json")
      .map((manifest) => (manifest === "package.json" ? "." : path.posix.dirname(manifest)))
      .sort();
  }

  facts(category: string): Fact[] {
    return categoryOf(this.document, category)?.facts ?? [];
  }

  packageName(directory: string): string | null {
    const fact = this.facts("package_identity").find((candidate) => manifestOfFact(candidate) === manifestPath(directory));
    const name = fact ? objectValue(fact)?.name : null;
    return typeof name === "string" ? name : null;
  }

  /** The deepest package directory containing +input+, or null when it's outside every package. */
  owner(input: string): string | null {
    const known = this.owners.get(input);
    if (known !== undefined) return known;
    let owner: string | null = null;
    for (const directory of this.packages) if (contains(directory, input) && (owner === null || owner === "." || directory.length > owner.length)) owner = directory;
    this.owners.set(input, owner);
    return owner;
  }

  evidencePath(id: string): string {
    const record = this.document.evidence[id] as JsonObject | undefined;
    return typeof record?.path === "string" ? record.path : "";
  }

  evidenceRule(id: string): string | null {
    const record = this.document.evidence[id] as JsonObject | undefined;
    return typeof record?.rule === "string" ? record.rule : null;
  }

  /**
   * +fact+ with its evidence, or only the evidence at paths +keep+ selects
   * for a fact reported once for the whole repository; `elsewhere` counts
   * the rest, so a verdict never copies every package's evidence.
   */
  decidingFact(category: string, fact: Fact, keep?: (input: string) => boolean): DecidingFact {
    let elsewhere = 0;
    const locate = (ids: readonly string[]) => {
      const kept = keep ? ids.filter((id) => keep(this.evidencePath(id))) : ids;
      elsewhere += ids.length - kept.length;
      return evidenceLocations(kept, this.document.evidence);
    };
    const evidence = locate(fact.evidence);
    const candidates = fact.candidates?.map((candidate) => ({ value: candidate.value, evidence: locate(candidate.evidence) }));
    return { category, key: fact.key, state: fact.state, value: fact.value, evidence, ...(candidates && { candidates }), ...(elsewhere > 0 && { elsewhere }) };
  }

  /** A category as a whole, when no fact of it decides: its state and the skipped inputs +relevant+ selects. */
  categoryFact(id: string, relevant: (input: string) => boolean = () => true): DecidingFact {
    const category = categoryOf(this.document, id);
    if (!category) return { category: id, key: null, state: "not_covered", value: null, evidence: [] };
    const skipped = category.search.skipped.filter(relevant);
    return { category: id, key: null, state: category.state, value: { complete: category.search.complete, skipped: skipped.slice(0, 20), skippedCount: skipped.length }, evidence: [] };
  }

  /** Why +category+ can't be trusted for the inputs +relevant+ selects, or null when its search covered them. */
  unknownReason(id: string, relevant: (input: string) => boolean): string | null {
    const category: Category | undefined = categoryOf(this.document, id);
    if (!category) return `${SURVEYOR_RELEASE_LABEL} ${this.document.detector_release} doesn't report it`;
    const skipped = category.search.skipped.filter(relevant);
    if (skipped.length) return `${paths(skipped)} could not be read or understood`;
    if (!category.search.complete) return "its search was incomplete";
    return null;
  }

  /** Whether +directory+ is a member of a workspace, and which root declares it. */
  membership(directory: string): Membership {
    let membership = this.memberships.get(directory);
    if (!membership) this.memberships.set(directory, (membership = this.decideMembership(directory)));
    return membership;
  }

  private decideMembership(directory: string): Membership {
    const category = categoryOf(this.document, "workspaces");
    if (!category) return { root: null, unknown: `${SURVEYOR_RELEASE_LABEL} ${this.document.detector_release} doesn't report workspaces`, facts: [this.categoryFact("workspaces")] };
    const fact = category.facts.find((candidate) => candidate.key === directory);
    if (!fact) {
      // A workspace declaration in an enclosing directory that couldn't be read might include it.
      const declaring = (input: string) => WORKSPACE_INPUTS.has(path.posix.basename(input)) && contains(path.posix.dirname(input), directory) && path.posix.dirname(input) !== directory;
      const skipped = category.search.skipped.filter(declaring);
      if (skipped.length) return { root: null, unknown: `${paths(skipped)} could not be read or understood`, facts: [this.categoryFact("workspaces", declaring)] };
      if (!category.search.complete) return { root: null, unknown: "its search was incomplete", facts: [this.categoryFact("workspaces")] };
      return { root: null, unknown: null, facts: [] };
    }
    const facts = [this.decidingFact("workspaces", fact)];
    if (fact.state === "conflicting" || fact.state === "unknown") return { root: null, unknown: `its workspace membership is ${fact.state}`, facts };
    const own = manifestPath(directory);
    const roots = [...new Set(fact.evidence.map((id) => this.evidencePath(id)).filter((input) => input !== own).map((input) => path.posix.dirname(input)))];
    if (roots.length !== 1 || !contains(roots[0]!, directory)) return { root: null, unknown: roots.length ? `${paths(roots.map(place))} each declare it` : "no workspace declaration names it", facts };
    return { root: roots[0]!, unknown: null, facts };
  }

  /**
   * The packages whose Node declarations apply to building +directory+ from
   * +installRoot+: its enclosing packages and, for a workspace install, every
   * member the install includes.
   */
  nodeScope(directory: string, installRoot: string): Set<string> {
    const scope = new Set(this.packages.filter((candidate) => contains(candidate, directory)));
    scope.add(installRoot);
    for (const member of this.packages) if (this.membership(member).root === installRoot) scope.add(member);
    return scope;
  }
}

// -- Helpers ----------------------------------------------------------------------

export function categoryOf(document: FactDocument, id: string): Category | undefined {
  return Object.hasOwn(document.categories, id) ? document.categories[id] : undefined;
}

export function contains(directory: string, input: string): boolean {
  return directory === "." || input === directory || input.startsWith(`${directory}/`);
}

export function objectValue(fact: Fact): JsonObject | null {
  return fact.value && typeof fact.value === "object" && !Array.isArray(fact.value) ? (fact.value as JsonObject) : null;
}

export function manifestOfFact(fact: Fact): string {
  const manifest = objectValue(fact)?.manifest;
  return typeof manifest === "string" ? manifest : fact.key.split("#")[0]!;
}

/** A directory as a sentence names it. */
export function place(directory: string): string {
  return directory === "." ? "the repository root" : directory;
}

/** Paths as a sentence names them: the first few, then how many more. */
export function paths(items: readonly string[], separator?: ", "): string {
  const named = items.slice(0, NAMED);
  const rest = items.length - named.length;
  if (separator) return rest > 0 ? `${named.join(separator)}, and ${rest} more` : named.join(separator);
  return rest > 0 ? `${named.join(", ")}, and ${rest} more` : list(named);
}
