import type Database from "better-sqlite3";
import { deriveSlug } from "../onboarding/slug";

/*
 * Data that a SQL migration can't compute, filled in after migrations run.
 * Each backfill is idempotent, so running it on every migrate is safe.
 */

/**
 * Gives each onboarded Portal without a slug the one its name derives
 * (add-portal-switcher design decision 5). A Portal is onboarded once it has
 * a revision; one named only in an ownership claim keeps no slug. A derived
 * slug that another Portal has, that two Portals would share, or that is
 * empty is left unset: slugs allow no digits, so there's no numbered
 * fallback.
 */
export function backfillPortalSlugs(sqlite: Database.Database): number {
  const columns = sqlite.prepare("select name from pragma_table_info('portals')").all() as { name: string }[];
  if (!columns.some((column) => column.name === "slug")) return 0;

  const taken = new Set((sqlite.prepare("select slug from portals where slug is not null").all() as { slug: string }[]).map((row) => row.slug));
  const candidates = sqlite
    .prepare("select id, label from portals p where slug is null and exists (select 1 from portal_revisions r where r.portal_id = p.id)")
    .all() as { id: number; label: string }[];
  const derived = new Map<string, number[]>();
  for (const { id, label } of candidates) {
    const slug = deriveSlug(label);
    if (slug && !taken.has(slug)) derived.set(slug, [...(derived.get(slug) ?? []), id]);
  }
  const update = sqlite.prepare("update portals set slug = ? where id = ?");
  let filled = 0;
  sqlite.transaction(() => {
    for (const [slug, ids] of derived) {
      if (ids.length !== 1) continue;
      update.run(slug, ids[0]);
      filled += 1;
    }
  })();
  return filled;
}
