import type Database from "better-sqlite3";
import { MAX_MENU_DEPTH, MENU_ROUTE } from "../onboarding/menu-rules";
import { deriveSlug } from "../onboarding/slug";
import { generatePublicId } from "./ids";

/*
 * Data that a SQL migration can't compute, filled in after migrations run.
 * Each backfill is idempotent, so running it on every migrate is safe.
 */

const tableExists = (sqlite: Database.Database, name: string) => Boolean(sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name));

/**
 * Gives each onboarded Portal without a slug the one its name derives
 * (add-portal-switcher design decision 5). A Portal is onboarded once it has
 * a revision; one named only in an ownership claim keeps no slug. After
 * migration 0032 drops revisions, the Portals it staged as onboarded stand
 * in for them, until carryMenus drops that table too. A derived slug that
 * another Portal has, that two Portals would share, or that is empty is left
 * unset: slugs allow no digits, so there's no numbered fallback.
 */
export function backfillPortalSlugs(sqlite: Database.Database): number {
  const columns = sqlite.prepare("select name from pragma_table_info('portals')").all() as { name: string }[];
  if (!columns.some((column) => column.name === "slug")) return 0;
  const onboarded = tableExists(sqlite, "portal_revisions")
    ? "exists (select 1 from portal_revisions r where r.portal_id = p.id)"
    : tableExists(sqlite, "_carried_onboarded_portals")
      ? "exists (select 1 from _carried_onboarded_portals c where c.portal_id = p.id)"
      : null;
  if (!onboarded) return 0;

  const taken = new Set((sqlite.prepare("select slug from portals where slug is not null").all() as { slug: string }[]).map((row) => row.slug));
  const candidates = sqlite.prepare(`select id, label from portals p where slug is null and ${onboarded}`).all() as { id: number; label: string }[];
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

/** Environments in the order their routes and defaults win when a menu is flattened; any other environment follows, by name. */
const ENVIRONMENT_PRECEDENCE = ["prod", "uat", "test", "dev"];
const precedence = (environment: string) => {
  const index = ENVIRONMENT_PRECEDENCE.indexOf(environment);
  return index === -1 ? ENVIRONMENT_PRECEDENCE.length : index;
};
const byPrecedence = (a: { environment: string }, b: { environment: string }) => precedence(a.environment) - precedence(b.environment) || a.environment.localeCompare(b.environment);

interface CarriedGroup {
  portal_id: number;
  key: string;
  parent_key: string | null;
  label: string;
  ordering: number;
}

interface CarriedRoute {
  portal_id: number;
  placement_id: number;
  application_id: number;
  environment: string;
  route: string;
  label: string;
  parent_key: string | null;
  ordering: number;
  is_default: number;
}

interface Entry {
  kind: "group" | "item";
  key: string;
  parentKey: string | null;
  label: string;
  ordering: number;
  route: string | null;
  applicationId: number | null;
  isDefault: boolean;
}

export interface CarriedMenus {
  carried: number;
  skipped: string[];
}

/**
 * Builds each Portal's menu from what migration 0032 staged
 * (make-applications-first-class design decision 11): its groups, then one
 * item per approved placement at the route of its highest environment, PROD
 * before UAT, TEST, and DEV. The default is the item the highest environment
 * with a default made the default. A route that another item already took,
 * one the new route rules refuse, one for an Application of another Portal,
 * and a group nested too deep are skipped and logged. Then the staged tables
 * are dropped, so it runs once.
 */
export function carryMenus(sqlite: Database.Database, log: (message: string) => void = console.warn): CarriedMenus {
  if (!tableExists(sqlite, "_carried_menu_routes")) return { carried: 0, skipped: [] };
  const groups = sqlite.prepare("select * from _carried_menu_groups order by portal_id, ordering, key").all() as CarriedGroup[];
  const routes = sqlite.prepare("select * from _carried_menu_routes order by portal_id, placement_id").all() as CarriedRoute[];
  const portalOf = sqlite.prepare("select portal_id as portalId from applications where id = ?");
  const portalLabel = sqlite.prepare("select label from portals where id = ?");
  const insert = sqlite.prepare("insert into portal_menu_items (public_id, portal_id, parent_id, kind, label, route, application_id, position, is_default) values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id");
  const result: CarriedMenus = { carried: 0, skipped: [] };
  const skip = (portalId: number, message: string) => result.skipped.push(`${(portalLabel.get(portalId) as { label: string } | undefined)?.label ?? `Portal ${portalId}`}: ${message}`);

  sqlite.transaction(() => {
    const portalIds = [...new Set([...groups.map((group) => group.portal_id), ...routes.map((route) => route.portal_id)])];
    for (const portalId of portalIds) {
      const entries: Entry[] = groups
        .filter((group) => group.portal_id === portalId)
        .map((group) => ({ kind: "group", key: `group:${group.key}`, parentKey: group.parent_key ? `group:${group.parent_key}` : null, label: group.label, ordering: group.ordering, route: null, applicationId: null, isDefault: false }));

      // One item per placement, at the route of its highest environment.
      const placements = new Map<number, CarriedRoute[]>();
      for (const route of routes.filter((candidate) => candidate.portal_id === portalId)) placements.set(route.placement_id, [...(placements.get(route.placement_id) ?? []), route]);
      const chosen = [...placements.values()].map((rows) => [...rows].sort(byPrecedence)[0]!).sort((a, b) => byPrecedence(a, b) || a.placement_id - b.placement_id);
      const defaultPlacement = routes.filter((route) => route.portal_id === portalId && route.is_default === 1).sort(byPrecedence)[0]?.placement_id ?? null;
      const taken = new Map<string, string>();
      for (const row of chosen) {
        if ((portalOf.get(row.application_id) as { portalId: number | null } | undefined)?.portalId !== portalId) {
          skip(portalId, `skipped ${row.route}, because its Application belongs to another Portal`);
          continue;
        }
        if (!MENU_ROUTE.test(row.route)) {
          skip(portalId, `skipped ${row.route}, because a route may hold only lowercase letters, digits, hyphens, and slashes`);
          continue;
        }
        const holder = taken.get(row.route);
        if (holder) {
          skip(portalId, `skipped ${row.route} for ${row.label}, because ${holder} already has it`);
          continue;
        }
        taken.set(row.route, row.label);
        entries.push({ kind: "item", key: `placement:${row.placement_id}`, parentKey: row.parent_key ? `group:${row.parent_key}` : null, label: row.label, ordering: row.ordering, route: row.route, applicationId: row.application_id, isDefault: row.placement_id === defaultPlacement });
      }

      // Parents before children, siblings by their order and then label.
      const keys = new Set(entries.map((entry) => entry.key));
      for (const entry of entries) {
        if (entry.parentKey && !keys.has(entry.parentKey)) {
          skip(portalId, `put ${entry.label} at the top level, because its group is missing`);
          entry.parentKey = null;
        }
      }
      const ids = new Map<string, number>();
      const place = (parentKey: string | null, depth: number) => {
        const siblings = entries.filter((entry) => entry.parentKey === parentKey).sort((a, b) => a.ordering - b.ordering || a.label.localeCompare(b.label));
        siblings.forEach((entry, position) => {
          if (depth > MAX_MENU_DEPTH) {
            skip(portalId, `skipped ${entry.label}, because menus nest at most ${MAX_MENU_DEPTH} levels`);
            return;
          }
          const parentId = parentKey ? (ids.get(parentKey) ?? null) : null;
          const { id } = insert.get(generatePublicId("mnu"), portalId, parentId, entry.kind, entry.label, entry.route, entry.applicationId, position, entry.isDefault ? 1 : 0) as { id: number };
          ids.set(entry.key, id);
          result.carried += 1;
          if (entry.kind === "group") place(entry.key, depth + 1);
        });
      };
      place(null, 1);
    }
    for (const table of ["_carried_menu_groups", "_carried_menu_routes", "_carried_onboarded_portals"]) sqlite.exec(`drop table ${table}`);
  })();
  for (const message of result.skipped) log(`Menu migration: ${message}.`);
  if (result.carried > 0) log(`Menu migration: carried ${result.carried} menu ${result.carried === 1 ? "entry" : "entries"} over.`);
  return result;
}
