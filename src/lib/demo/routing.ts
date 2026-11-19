import type { AppDefinition, EnvironmentId, GroupMember } from "./catalog";

/**
 * Which version and environment each member of a microfrontends group is
 * served from, and why (template-demo/microfrontends spec). Pure, so the
 * application page and the toolbar agree.
 */

type RoutingReason = "default" | "override" | "fallback";

export interface MemberRouting {
  readonly member: string;
  readonly version: string;
  readonly environment: EnvironmentId;
  readonly reason: RoutingReason;
}

export interface RoutingOverride {
  readonly version: string;
  readonly environment: EnvironmentId;
}

/**
 * Where a member is served without overrides. A sandbox serves every member
 * from the sandbox. A dev environment builds only the template's child
 * members, so members it did not build, such as the portal shell, fall back to
 * production. Reference deployments run in production.
 */
export function defaultRouting(member: GroupMember, deployed: EnvironmentId): MemberRouting {
  if (deployed === "dev" && member.role === "default") return { member: member.id, version: member.defaultVersion, environment: "production", reason: "fallback" };
  return { member: member.id, version: member.defaultVersion, environment: deployed, reason: "default" };
}

export function resolveRouting(app: AppDefinition, deployed: EnvironmentId, overrides: Readonly<Record<string, RoutingOverride>> = {}): Record<string, MemberRouting> {
  return Object.fromEntries(
    app.members.map((member) => {
      const override = overrides[member.id];
      const valid = override && member.versions.some((version) => version.version === override.version) && availableEnvironments(member, deployed).includes(override.environment);
      return [member.id, valid ? { member: member.id, version: override.version, environment: override.environment, reason: "override" as const } : defaultRouting(member, deployed)];
    }),
  );
}

/** The environments a member can be routed to: production, plus where the application was deployed if the member was built there. */
export function availableEnvironments(member: GroupMember, deployed: EnvironmentId): EnvironmentId[] {
  const built = deployed !== "production" && !(deployed === "dev" && member.role === "default");
  return built ? ["production", deployed] : ["production"];
}



