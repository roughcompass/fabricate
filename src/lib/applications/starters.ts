import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { STARTER_KINDS } from "./vocabulary";

/*
 * The starters Add application offers (application-creation spec, "Starters
 * are content in a file"; design decision 4). They're YAML in config/, so a
 * new starter needs no code change. Like "What's included", a broken file
 * doesn't block anything: Build your solution explains that starters are
 * unavailable, and the problem is logged once. One invalid starter is left
 * out, and logged, without hiding the rest.
 */

export const STARTERS_FILE = path.join("config", "application-starters.yaml");

/** How many starters Build your solution shows; the full catalog lists the rest. */
export const FEATURED_STARTERS = 4;

const text = (max: number) => z.string().trim().min(1).max(max);

const starterSchema = z.strictObject({
  slug: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, "must be lowercase letters, digits, and hyphens, starting with a letter"),
  kind: z.enum(STARTER_KINDS),
  title: text(120),
  description: text(200),
  preview: z.string().regex(/^\/[A-Za-z0-9._/-]+$/, "must be a path under public/, starting with /"),
  sourceUrl: z.url({ protocol: /^https$/ }),
  steps: z.array(z.strictObject({ text: text(300), command: text(500).optional() })).min(1).max(20),
});

export type Starter = z.infer<typeof starterSchema>;
export type StartersResult = { ok: true; starters: Starter[]; skipped: string[] } | { ok: false; problem: string };

/** Reads the starters at +file+, relative to the working directory unless absolute, leaving out each invalid one. */
export function readStarters(file: string): StartersResult {
  const location = path.resolve(/*turbopackIgnore: true*/ process.cwd(), file);
  let source: string;
  try {
    source = fs.readFileSync(/*turbopackIgnore: true*/ location, "utf8");
  } catch (error) {
    return { ok: false, problem: `${file} can't be read: ${(error as Error).message}` };
  }
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    return { ok: false, problem: `${file} isn't valid YAML: ${(error as Error).message}` };
  }
  const list = z.strictObject({ starters: z.array(z.unknown()) }).safeParse(value);
  if (!list.success) return { ok: false, problem: `${file} needs a top-level starters list` };

  const starters: Starter[] = [];
  const skipped: string[] = [];
  const slugs = new Set<string>();
  list.data.starters.forEach((entry, index) => {
    const parsed = starterSchema.safeParse(entry);
    const name = (entry as { slug?: unknown } | null)?.slug;
    const label = `${file} starters.${index}${typeof name === "string" ? ` (${name})` : ""}`;
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      skipped.push(`${label} at ${issue.path.length ? issue.path.join(".") : "the top level"}: ${issue.message}`);
    } else if (slugs.has(parsed.data.slug)) {
      skipped.push(`${label}: another starter has the slug ${parsed.data.slug}`);
    } else {
      slugs.add(parsed.data.slug);
      starters.push(parsed.data);
    }
  });
  return { ok: true, starters, skipped };
}

let cached: StartersResult | undefined;
const logged = new Set<string>();

/**
 * The starters, in file order, or null when the file can't be used. In
 * production the file is read once per process; in development, on every
 * call, so an edit appears on the next page load. FABRICATE_STARTERS_FILE
 * points it at another file, for tests.
 */
export function starters(): Starter[] | null {
  const development = process.env.NODE_ENV !== "production";
  const result = (!development && cached) || readStarters(process.env.FABRICATE_STARTERS_FILE || STARTERS_FILE);
  cached = result;
  const problems = result.ok ? result.skipped.map((problem) => `A starter is left out: ${problem}`) : [`Starters are unavailable: ${result.problem}`];
  for (const problem of problems) {
    if (!logged.has(problem)) console.error(problem);
    logged.add(problem);
  }
  return result.ok ? result.starters : null;
}

/** The starter named +slug+, if the file has it. */
export function starterBySlug(slug: string | null | undefined): Starter | undefined {
  return slug ? starters()?.find((starter) => starter.slug === slug) : undefined;
}
