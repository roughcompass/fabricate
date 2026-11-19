import type { JsonObject } from "@repo-facts/contract";
import type { DesignSystemFigures, RecognizedDesignSystem, ScopeProps, designSystemProfiles, designSystemUsage } from "@/lib/db/schema";
import { asArray, asObject, isJsonObject } from "@/lib/json";

/*
 * The design-system projection (establish-frontend-registry, design
 * decision 7): from a Profile's fact document, one row per design-system
 * component the repository uses and per raw HTML element a design-system
 * component replaces, with their counts per scope and a component's props;
 * and one row per Profile with the states of its design-system categories
 * and the design systems it recognizes. Fact documents before version 3 have
 * no props or entries, and those before version 2 no design-system
 * categories; whatever a document lacks is left out.
 */

type UsageRow = Omit<typeof designSystemUsage.$inferInsert, "profileId" | "documentDigest" | "projectionVersion">;
type ProfileRow = Omit<typeof designSystemProfiles.$inferInsert, "profileId" | "documentDigest" | "projectionVersion">;

const SCOPES = ["app", "stories", "tests"] as const;
/** Facts that state something about the repository; unknown and conflicting ones are left out of counts. */
const COUNTED = new Set(["observed", "inferred"]);

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const text = (value: unknown) => (typeof value === "string" ? value : null);

function factsOf(categories: JsonObject, id: string): JsonObject[] {
  return asArray(asObject(categories[id]).facts).filter(isJsonObject);
}

/** The usage rows of the fact document +facts+. */
export function designSystemUsageRows(facts: JsonObject): UsageRow[] {
  const categories = asObject(facts.categories);
  const entries = entryDigests(categories);
  const rows: UsageRow[] = [];
  for (const fact of factsOf(categories, "ui_elements")) {
    if (!COUNTED.has(String(fact.state))) continue;
    const key = String(fact.key);
    const value = asObject(fact.value);
    const component = /^component:([^:]+):(.+)$/.exec(key);
    if (component) {
      const [, system, name] = component as unknown as [string, string, string];
      rows.push({
        designSystem: system,
        entryDigest: entries.get(system) ?? null,
        kind: "component",
        name,
        counterpart: text(value.package),
        ...scopeCounts(value, (scope) => [count(scope.sites), count(scope.customized), count(scope.unknown)]),
        props: isJsonObject(value.props) ? propsOf(value.props) : null,
      });
      continue;
    }
    const element = /^intrinsic:(.+)$/.exec(key);
    const equivalent = /^([^:]+):(.+)$/.exec(text(value.equivalent) ?? "");
    if (element && equivalent) {
      const [, system, replacement] = equivalent as unknown as [string, string, string];
      rows.push({
        designSystem: system,
        entryDigest: entries.get(system) ?? null,
        kind: "element",
        name: element[1]!,
        counterpart: replacement,
        ...scopeCounts(value, (scope) => [count(scope.sites), count(scope.styled), count(scope.styled_unresolved)]),
        props: null,
      });
    }
  }
  return rows;
}

/** The Profile row of the fact document +facts+. */
export function designSystemProfileRow(facts: JsonObject): ProfileRow {
  const categories = asObject(facts.categories);
  const state = (id: string) => (isJsonObject(categories[id]) ? text(categories[id].state) : null);
  const wanted = new Map(
    asArray(facts.catalog_entries)
      .filter(isJsonObject)
      .filter((entry) => entry.kind === "design_system")
      .map((entry) => [String(entry.id), asObject(entry.wanted)]),
  );
  const summary = (id: string, system: string) => asObject(factsOf(categories, id).find((fact) => fact.key === `summary:${system}`)?.value);
  const recognized = factsOf(categories, "design_systems")
    .filter((fact) => COUNTED.has(String(fact.state)))
    .map((fact): RecognizedDesignSystem => {
      const id = String(fact.key);
      const value = asObject(fact.value);
      const elements = summary("ui_elements", id);
      const styles = summary("style_values", id);
      const figures = (scope: (typeof SCOPES)[number]): DesignSystemFigures => ({
        designSystem: count(asObject(elements[scope]).design_system),
        elements: count(asObject(elements[scope]).elements),
        tokenized: count(asObject(styles[scope]).tokenized),
        tokenCapable: count(asObject(styles[scope]).token_capable),
      });
      const entry = asObject(value.entry);
      const want = wanted.get(id);
      return {
        id,
        name: text(value.name) ?? id,
        ...("entry" in value && { entry: text(entry.version) && text(entry.digest) ? { version: text(entry.version)!, digest: text(entry.digest)! } : null }),
        ...(want && { wanted: { package: String(want.package), version: text(want.version) } }),
        app: figures("app"),
        stories: figures("stories"),
        tests: figures("tests"),
      };
    });
  return { designSystemsState: state("design_systems"), uiElementsState: state("ui_elements"), styleValuesState: state("style_values"), recognized };
}

/** The digest of the entry each recognized design system's facts were compared against. */
function entryDigests(categories: JsonObject): Map<string, string> {
  const digests = new Map<string, string>();
  for (const fact of factsOf(categories, "design_systems")) {
    const digest = text(asObject(asObject(fact.value).entry).digest);
    if (digest) digests.set(String(fact.key), digest);
  }
  return digests;
}

type ScopeColumns = Pick<UsageRow, "appSites" | "appCustomized" | "appUnknown" | "storiesSites" | "storiesCustomized" | "storiesUnknown" | "testsSites" | "testsCustomized" | "testsUnknown">;

function scopeCounts(value: JsonObject, read: (scope: JsonObject) => [sites: number, customized: number, unknown: number]): ScopeColumns {
  const [app, stories, tests] = SCOPES.map((scope) => read(asObject(value[scope])));
  return {
    appSites: app![0],
    appCustomized: app![1],
    appUnknown: app![2],
    storiesSites: stories![0],
    storiesCustomized: stories![1],
    storiesUnknown: stories![2],
    testsSites: tests![0],
    testsCustomized: tests![1],
    testsUnknown: tests![2],
  };
}

function propsOf(props: JsonObject): { app: ScopeProps; stories: ScopeProps; tests: ScopeProps } {
  const scope = (value: unknown): ScopeProps => {
    const names: ScopeProps["names"] = {};
    for (const [name, prop] of Object.entries(asObject(asObject(value).names))) {
      const values = asObject(asObject(prop).values);
      names[name] = { count: count(asObject(prop).count), ...(Object.keys(values).length && { values: Object.fromEntries(Object.entries(values).map(([literal, times]) => [literal, count(times)])) }) };
    }
    return { unknown: count(asObject(value).unknown), names };
  };
  return { app: scope(props.app), stories: scope(props.stories), tests: scope(props.tests) };
}
