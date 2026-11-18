import { TEMPLATES } from "./templates";
import type { AppDefinition, AppRoute, GroupMember, LoadEntry, Template } from "./types";

export * from "./brands";
export * from "./types";
export { SHELL_MEMBERS } from "./heroes";
export { HERO_SLUGS, TEMPLATES } from "./templates";

/** Reference deployments are virtual applications with this ID prefix (design.md, decision 2). */
export const REFERENCE_PREFIX = "ref-";

export function templateBySlug(slug: string): Template | undefined {
  return TEMPLATES.find((template) => template.slug === slug);
}

export function referenceId(slug: string): string {
  return `${REFERENCE_PREFIX}${slug}`;
}

/** The template a reference-deployment ID names, if it is one. */
export function referenceTemplate(id: string): Template | undefined {
  return id.startsWith(REFERENCE_PREFIX) ? templateBySlug(id.slice(REFERENCE_PREFIX.length)) : undefined;
}

export function memberById(app: AppDefinition, id: string): GroupMember | undefined {
  return app.members.find((member) => member.id === id);
}

export function shellOf(app: AppDefinition): GroupMember {
  return app.members.find((member) => member.role === "default")!;
}

export function startRoute(app: AppDefinition): AppRoute {
  return app.routes[0]!;
}

export function routeByPath(app: AppDefinition, path: string): AppRoute | undefined {
  return app.routes.find((route) => route.path === path);
}

/** Where a member renders, for operators: "Route /payees", "Slot Sidebar on /payees", or "All routes". */
export function routingLabel(member: GroupMember): string {
  switch (member.routing.kind) {
    case "shell":
      return "All routes";
    case "route":
      return `Route /${member.routing.path}`;
    case "slot":
      return `Slot ${member.routing.slot} on /${member.routing.route}`;
  }
}

const CHILD_STAGGER_MS = 80;

/**
 * The scripted load sequence of a route: the shell first, then each region in
 * order, each starting a fixed stagger after the shell finishes. The same
 * route and versions always produce the same sequence.
 */
export function loadSequence(app: AppDefinition, route: AppRoute, versions: Readonly<Record<string, string>>): LoadEntry[] {
  const shell = shellOf(app);
  const entries: LoadEntry[] = [{ member: shell.id, version: versions[shell.id] ?? shell.defaultVersion, startMs: 0, durationMs: shell.loadMs }];
  route.regions.forEach((region, index) => {
    const member = memberById(app, region.member)!;
    entries.push({ member: member.id, version: versions[member.id] ?? member.defaultVersion, startMs: shell.loadMs + index * CHILD_STAGGER_MS, durationMs: member.loadMs });
  });
  return entries;
}
