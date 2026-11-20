import { eq } from "drizzle-orm";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { previewBuilds, previewPreparations } from "@/lib/db/schema";
import { isJsonObject } from "@/lib/json";
import { profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";
import type { Fact, FactDocument } from "@/lib/profiles/states";

/*
 * What a build is composed of, from the Profile of its commit
 * (restore-toolbar-tools-and-branch-previews, design decisions 7 and 9): the
 * Module Federation remotes and import-map entries it loads, its single-spa
 * roles, the containers it is itself, and whether it renders a Salt
 * provider. The toolbar's Microfrontends and Settings tools start from it;
 * what the page loads at run time comes from the frame agent.
 */

/** A Module Federation remote a build loads: the alias it imports, the container it names, and its entry's address as built, or null when code chooses it. */
export interface ComposedRemote {
  readonly alias: string;
  readonly container: string | null;
  readonly entry: string | null;
}

/** An import-map entry: the specifier and the address it maps to. */
export interface ComposedImport {
  readonly specifier: string;
  readonly url: string;
}

/** A Module Federation container a build is, with the modules it exposes. */
export interface ComposedContainer {
  readonly name: string;
  readonly exposes: readonly string[];
}

export interface BuildComposition {
  readonly remotes: readonly ComposedRemote[];
  readonly imports: readonly ComposedImport[];
  readonly singleSpa: { readonly rootConfig: boolean; readonly application: boolean };
  readonly containers: readonly ComposedContainer[];
  /** Whether the package renders a Salt provider, from design-system usage facts. */
  readonly saltProvider: boolean;
}

export const NO_COMPOSITION: BuildComposition = { remotes: [], imports: [], singleSpa: { rootConfig: false, application: false }, containers: [], saltProvider: false };

/** The fact document of the Profile that decided the build +preview+, by its public ID, or null when it has none. */
export function buildFactDocument(db: Executor, preview: string): FactDocument | null {
  const row = db
    .select({ surveyId: previewPreparations.surveyId })
    .from(previewBuilds)
    .innerJoin(previewPreparations, eq(previewPreparations.id, previewBuilds.preparationId))
    .where(eq(previewBuilds.publicId, preview))
    .get();
  if (!row?.surveyId) return null;
  const profile = profileOfSurvey(db, row.surveyId);
  const document = profile ? profileDocument(profile).fact_document : null;
  return isJsonObject(document as JsonValue) ? (document as unknown as FactDocument) : null;
}

/** Whether +fact+ is about the package in +packageDir+: any of its evidence lies in that directory. The root package takes every fact. */
function inPackage(fact: Fact, evidence: JsonObject, packageDir: string): boolean {
  if (packageDir === ".") return true;
  return fact.evidence.some((id) => {
    const record = evidence[id];
    const path = isJsonObject(record as JsonValue) ? String((record as JsonObject).path ?? "") : "";
    return path.startsWith(`${packageDir}/`);
  });
}

function factsOf(document: FactDocument, category: string, packageDir: string): Fact[] {
  const facts = Object.hasOwn(document.categories, category) ? document.categories[category]!.facts : [];
  return facts.filter((fact) => fact.state !== "conflicting" && isJsonObject(fact.value) && inPackage(fact, document.evidence, packageDir));
}

/** A captured literal as text, or null for anything unresolved or absent. */
function literal(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return value;
  if (isJsonObject(value ?? null) && (value as JsonObject).kind === "literal" && typeof (value as JsonObject).value === "string") return (value as JsonObject).value as string;
  return null;
}

const list = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);

function remoteOf(value: JsonValue): ComposedRemote | null {
  if (!isJsonObject(value) || typeof value.kind === "string") return null;
  const container = typeof value.federation_name === "string" ? value.federation_name : null;
  const alias = typeof value.alias === "string" ? value.alias : container;
  return alias ? { alias, container, entry: literal(value.entry) } : null;
}

/** What the Profile of the build +preview+ says its package, in +packageDir+, is composed of. */
export function buildComposition(db: Executor, preview: string, packageDir: string): BuildComposition {
  return compositionOf(buildFactDocument(db, preview), packageDir);
}

/** What the Profile +document+ says the package in +packageDir+ is composed of. */
export function compositionOf(document: FactDocument | null, packageDir = "."): BuildComposition {
  if (!document) return NO_COMPOSITION;
  const remotes: ComposedRemote[] = [];
  const imports: ComposedImport[] = [];
  const containers: ComposedContainer[] = [];
  let rootConfig = false;
  let application = false;
  for (const fact of factsOf(document, "composition", packageDir)) {
    const value = fact.value as JsonObject;
    if (value.mechanism === "module-federation") {
      for (const remote of list(value.remotes)) {
        const composed = remoteOf(remote);
        if (composed && !remotes.some((known) => known.alias === composed.alias)) remotes.push(composed);
      }
      const name = literal(value.name);
      const exposes = list(value.exposes).filter((entry): entry is string => typeof entry === "string");
      if (name && exposes.length) containers.push({ name, exposes });
    } else if (value.mechanism === "import-map" && typeof value.specifier === "string" && typeof value.url === "string") {
      if (!imports.some((known) => known.specifier === value.specifier)) imports.push({ specifier: value.specifier, url: value.url });
    } else if (value.mechanism === "single-spa") {
      if (value.role === "root-config") rootConfig = true;
      if (value.role === "application") application = true;
    }
  }
  const saltProvider = factsOf(document, "design_systems", packageDir).some((fact) => fact.key === "salt" && (fact.value as JsonObject).provider === true);
  return { remotes, imports, singleSpa: { rootConfig, application }, containers, saltProvider };
}
