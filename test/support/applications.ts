import type { Executor } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { applications } from "@/lib/db/schema";
import type { Portal } from "@/lib/onboarding/portals";
import { buildSource } from "./builders";

/*
 * Builders for Application tests: a registered Application in a Portal, with
 * its own Repository, written directly so a test about menus or lists
 * doesn't depend on Create Application.
 */

export interface RegisteredApplication {
  name: string;
  portal: Pick<Portal, "id">;
  slug?: string;
  sealId?: string;
  description?: string;
  starter?: string | null;
  createdBy?: string;
}

export function registerApplication(db: Executor, input: RegisteredApplication): typeof applications.$inferSelect {
  const slug = input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const source = buildSource(db, { name: slug, cloneUrl: `https://github.com/acme/${slug}.git`, canonicalUrl: `https://github.com/acme/${slug}` });
  const now = new Date();
  return db
    .insert(applications)
    .values({
      publicId: generatePublicId("wap"),
      name: input.name,
      slug,
      sealId: input.sealId ?? "88001",
      description: input.description ?? `${input.name}, registered for a test`,
      starter: input.starter ?? null,
      repositorySourceId: source.id,
      portalId: input.portal.id,
      createdBy: input.createdBy ?? "ana@example.com",
      verification: "unverified",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}
