import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { PORTAL_PLATFORMS } from "./vocabulary";

/*
 * The "What's included" content beside the Create Portal form
 * (portal-creation spec, add-portal-switcher design decision 7). It's YAML in
 * config/, so adding an item needs no code change. A file that's missing,
 * malformed, or the wrong shape doesn't block creation: the form shows
 * without the pane, and the problem is logged once. A unit test loads the
 * committed file, so a broken one fails the checks before it ships.
 */

export const WHATS_INCLUDED_FILE = path.join("config", "portal-whats-included.yaml");

const text = z.string().trim().min(1).max(120);

const itemSchema = z.strictObject({
  title: text,
  description: text,
  badge: z.literal("new").optional(),
  platforms: z.array(z.enum(PORTAL_PLATFORMS)).min(1).optional(),
});

export const whatsIncludedSchema = z.strictObject({
  title: text,
  items: z.array(itemSchema).min(1),
  link: z
    .strictObject({
      label: text,
      href: z.url({ protocol: /^https$/ }),
    })
    .optional(),
});

export type WhatsIncluded = z.infer<typeof whatsIncludedSchema>;
export type WhatsIncludedResult = { ok: true; content: WhatsIncluded } | { ok: false; problem: string };

/** Reads, parses, and checks the content file at +file+, relative to the working directory unless absolute. */
export function readWhatsIncluded(file: string): WhatsIncludedResult {
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
  const parsed = whatsIncludedSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, problem: `${file} at ${issue.path.length ? issue.path.join(".") : "the top level"}: ${issue.message}` };
  }
  return { ok: true, content: parsed.data };
}

let cached: WhatsIncludedResult | undefined;
let logged: string | undefined;

/**
 * The content the dialog shows, or null when the file can't be used. In
 * production the file is read once per process; in development, on every
 * call, so an edit appears on the next page load. FABRICATE_WHATS_INCLUDED_FILE
 * points it at another file, for tests.
 */
export function whatsIncluded(): WhatsIncluded | null {
  const development = process.env.NODE_ENV !== "production";
  const result = (!development && cached) || readWhatsIncluded(process.env.FABRICATE_WHATS_INCLUDED_FILE || WHATS_INCLUDED_FILE);
  if (!result.ok && result.problem !== logged) console.error(`What's included is hidden: ${result.problem}`);
  logged = result.ok ? undefined : result.problem;
  cached = result;
  return result.ok ? result.content : null;
}
