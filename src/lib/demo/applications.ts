import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { demoApplications } from "@/lib/db/schema";

/** Applications visitors created from templates. Their deployments are simulated. */

export type DemoApplication = typeof demoApplications.$inferSelect;

export function findApplication(db: Executor, publicId: string): DemoApplication | null {
  if (!isPublicId(publicId, "app")) return null;
  return db.select().from(demoApplications).where(eq(demoApplications.publicId, publicId)).get() ?? null;
}

export function findApplicationById(db: Executor, id: number): DemoApplication | null {
  return db.select().from(demoApplications).where(eq(demoApplications.id, id)).get() ?? null;
}

/** A workspace's application, or null when it belongs to someone else or does not exist. */
export function findOwnApplication(db: Executor, workspaceId: number, publicId: string): DemoApplication | null {
  if (!isPublicId(publicId, "app")) return null;
  return db
    .select()
    .from(demoApplications)
    .where(and(eq(demoApplications.publicId, publicId), eq(demoApplications.workspaceId, workspaceId)))
    .get() ?? null;
}

export function listApplications(db: Executor, workspaceId: number): DemoApplication[] {
  return db.select().from(demoApplications).where(eq(demoApplications.workspaceId, workspaceId)).orderBy(desc(demoApplications.createdAt), desc(demoApplications.id)).all();
}
