import fs from "node:fs";
import path from "node:path";
import { CatalogBuildError, type CatalogThing, catalogThingSchema, parseRules } from "@repo-facts/catalog-builder";
import { StructuredParseError, parseYaml } from "@repo-facts/contract";
import { z } from "zod";
import { ConfigurationError, type FrontendRegistryConfig, getConfig } from "@/lib/config";

/*
 * The things the Reference Catalog describes (establish-frontend-registry,
 * design decision 5). config/catalog.yaml lists each one with its packages
 * and sources, as the Catalog Builder takes it, and
 * config/catalog-rules/<id>.yaml holds the Digital Enablement team's rules
 * for it, reviewed like code. Both are read once per configuration, and the
 * worker and the web server refuse to start when either is invalid.
 */

export const CATALOG_FILE = "config/catalog.yaml";
export const RULES_DIRECTORY = "config/catalog-rules";

/** A thing the Reference Catalog describes, with the team's rules for it. */
export type DescribedThing = CatalogThing & {
  /** Its kind and id, such as `design_system:salt`. */
  readonly key: string;
  readonly rules: {
    /** The rules file, from the app root. */
    readonly file: string;
    readonly text: string;
    /** What the rules say, as a digest: the version an entry's sources record for them. */
    readonly version: string;
  };
};

export interface CatalogConfiguration {
  readonly things: readonly DescribedThing[];
}

const fileSchema = z.strictObject({ things: z.array(catalogThingSchema) });

/** `design_system:salt`: a thing's kind and id, as surveys record the things they were given entries of. */
export function thingKey(thing: { kind: string; id: string }): string {
  return `${thing.kind}:${thing.id}`;
}

/** Reads and validates config/catalog.yaml and each thing's rules under +appRoot+. */
export function loadCatalog(appRoot: string): CatalogConfiguration {
  const file = path.join(/*turbopackIgnore: true*/ appRoot, CATALOG_FILE);
  const parsed = fileSchema.safeParse(readYaml(file, CATALOG_FILE));
  if (!parsed.success) throw new ConfigurationError(`Invalid ${CATALOG_FILE}:\n${z.prettifyError(parsed.error)}`);

  const seen = new Set<string>();
  const things = parsed.data.things.map((thing): DescribedThing => {
    const key = thingKey(thing);
    if (seen.has(key)) throw new ConfigurationError(`${CATALOG_FILE} describes ${key} more than once`);
    seen.add(key);
    return { ...thing, key, rules: readRules(appRoot, thing) };
  });
  return { things };
}

const loaded = new WeakMap<FrontendRegistryConfig, CatalogConfiguration>();

/** The things +config+'s app root describes, read on first use. */
export function catalogConfiguration(config: FrontendRegistryConfig = getConfig()): CatalogConfiguration {
  let catalog = loaded.get(config);
  if (!catalog) loaded.set(config, (catalog = loadCatalog(config.appRoot)));
  return catalog;
}

/** A thing's rules, checked as the Catalog Builder checks them, so a build never fails on them. */
function readRules(appRoot: string, thing: CatalogThing): DescribedThing["rules"] {
  const relative = `${RULES_DIRECTORY}/${thing.id}.yaml`;
  let text: string;
  try {
    text = fs.readFileSync(path.join(/*turbopackIgnore: true*/ appRoot, relative), "utf8");
  } catch (error) {
    throw new ConfigurationError(`${CATALOG_FILE} describes ${thing.id}, but ${relative} can't be read: ${(error as Error).message}`);
  }
  let rules: ReturnType<typeof parseRules>;
  try {
    rules = parseRules(text, relative);
  } catch (error) {
    if (error instanceof CatalogBuildError) throw new ConfigurationError(`Invalid ${relative}: ${[error.message, ...error.problems].join("\n")}`);
    throw error;
  }
  if (rules.rules.id !== thing.id) throw new ConfigurationError(`${relative} describes ${rules.rules.id}, not ${thing.id}`);
  for (const name of [thing.package, thing.tokens, thing.icons]) {
    if (name && !rules.rules.packages.includes(name)) throw new ConfigurationError(`${relative} doesn't list ${name} among ${thing.id}'s packages`);
  }
  return { file: relative, text, version: rules.version };
}

function readYaml(file: string, label: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch (error) {
    throw new ConfigurationError(`Could not read ${file}: ${(error as Error).message}`);
  }
  try {
    return parseYaml(text);
  } catch (error) {
    if (error instanceof StructuredParseError) throw new ConfigurationError(`${label} isn't valid YAML: ${error.message}`);
    throw error;
  }
}
