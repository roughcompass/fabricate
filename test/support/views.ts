import type { ViewedApplication } from "@/lib/workspaces/access";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { buildRepository } from "./builders";
import { type DecideOptions, decidedPreparation, onboard, qualifyingVerdict } from "./applications";

/*
 * Applications for workspace tests: comment threads and share links belong to
 * one (add-applications, design decision 7). They're created as onboarding
 * creates them, from a decided preparation, with previews on for the remote.
 */

let made = 0;

/** A new application of a new Repository, named +name+, as a view sees it; +options.hooks+ false decides its commit without the applications' hooks, for a schema older than the code. */
export function viewedApplicationIn(db: Db, name = `Orders portal ${++made}`, options: DecideOptions = {}): ViewedApplication {
  const repository = buildRepository(db, { name: `orders-${made}-${Math.random().toString(36).slice(2, 8)}`, cloneUrl: `https://git.example.com/acme/orders-${made}-${Math.random().toString(36).slice(2, 8)}.git` });
  const config = withOverrides(getConfig(), { previews: { enabled: true, trustedSources: [repository.canonicalUrl] } });
  const row = onboard(db, config, repository, { name, preparation: decidedPreparation(db, repository, [qualifyingVerdict(".")], undefined, undefined, options) });
  return { id: row.id, publicId: row.publicId, slug: row.slug };
}

/** A commit SHA made of +digit+. */
export const commitOf = (digit: string) => digit.repeat(40);

/** An anchor on the Export orders button. */
export const EXPORT_ORDERS = { path: "#content > div > button:nth-of-type(2)", tag: "button", fingerprint: "Export orders" } as const;
