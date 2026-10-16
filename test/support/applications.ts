import { eq } from "drizzle-orm";
import type { Determination } from "@/lib/applications/rendering";
import type { RenderingMode } from "@/lib/applications/vocabulary";
import type { Executor } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { applications, repositorySources } from "@/lib/db/schema";
import { deWebInitiative } from "@/lib/initiatives/initiative-records";
import type { Portal } from "@/lib/onboarding/portals";
import { buildAssessment, buildSource } from "./builders";

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

/**
 * Records +mode+ as the Application's rendering, determined by a DE Web
 * Assessment of its repository with no facts, as a list or filter test needs
 * it; tests of how it's decided use recordRenderingDeterminations.
 */
export function determineRendering(db: Executor, application: typeof applications.$inferSelect, mode: RenderingMode): typeof applications.$inferSelect {
  const source = db.select().from(repositorySources).where(eq(repositorySources.id, application.repositorySourceId!)).get()!;
  const { assessment } = buildAssessment(db, { initiative: deWebInitiative(db), sources: [source] });
  const rule = mode === "module_federation_2" ? "module-federation-exposes" : mode === "esm" ? "single-spa-application" : mode === "iframe" ? "web-framework" : "none";
  const determination: Determination = { mode, rule, reason: mode === "undetermined" ? "No rule matched the repository" : null, deciding: [], alsoObserved: [], candidates: [], profile: "prf_none", assessment: assessment.publicId };
  return db
    .update(applications)
    .set({ renderingMode: mode, renderingEvidence: JSON.stringify(determination), renderingAssessmentId: assessment.id })
    .where(eq(applications.id, application.id))
    .returning()
    .get();
}
