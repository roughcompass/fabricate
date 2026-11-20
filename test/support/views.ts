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

/** A saved preview of +ref+ for +application+, still building its first commit, as a view names it. */
export function savedPreviewIn(db: Db, application: ViewedApplication, ref = "refs/heads/feature/new-nav", key = ref.replace(/^refs\/(heads|tags)\//, "").replace(/[^a-z0-9.]+/g, "-")): { id: number; key: string; ref: string } {
  const row = db.$client.prepare("select latest_commit_sha as commit_sha from applications where id = ?").get(application.id) as { commit_sha: string };
  const inserted = db.$client
    .prepare("insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, 0, 0, 0)")
    .run(`apv_${Math.random().toString(36).slice(2).padEnd(16, "0").slice(0, 16)}`, application.id, key, ref, row.commit_sha);
  return { id: Number(inserted.lastInsertRowid), key, ref };
}
