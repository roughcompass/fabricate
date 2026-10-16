import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { PrototypesExecutor } from "./db/client";
import { versions } from "./db/schema";
import type { Audit, AuditViolation, RenderError } from "./types";

/**
 * Evidence the frame reports about a version after it is ready: its
 * accessibility audit and any render error, each recorded once, from the
 * version's first render (quality-checks spec, "An accessibility audit runs
 * on the rendered version"; preview spec, "Rendering errors are contained
 * and recorded"). The frame can't reach DE FabLab, so the page that embeds it
 * relays what it reports, and both are checked here as untrusted input.
 */

const text = (max: number) => z.string().max(max * 4).transform((value) => value.slice(0, max));

export const auditSchema = z.object({
  violations: z
    .array(
      z.object({
        rule: text(80),
        impact: z.enum(["minor", "moderate", "serious", "critical"]),
        description: text(400),
        help: text(300),
        targets: z.array(text(400)).max(25),
        html: z.array(text(300)).max(25),
      }),
    )
    .max(100),
});

export const renderErrorSchema = z.object({ message: text(1_000) });

/** Records the version's first audit; a later report for the same version changes nothing. */
export async function recordAudit(db: PrototypesExecutor, workspaceId: string, versionId: string, violations: readonly AuditViolation[], now = new Date()): Promise<boolean> {
  const audit: Audit = { at: now.toISOString(), violations: [...violations] };
  const rows = await db
    .update(versions)
    .set({ audit })
    .where(and(eq(versions.id, versionId), eq(versions.workspaceId, workspaceId), eq(versions.status, "ready"), isNull(versions.audit)))
    .returning({ id: versions.id });
  return rows.length > 0;
}

/** Records the version's first render error, which the next refinement receives. */
export async function recordRenderError(db: PrototypesExecutor, workspaceId: string, versionId: string, message: string, now = new Date()): Promise<boolean> {
  const renderError: RenderError = { at: now.toISOString(), message };
  const rows = await db
    .update(versions)
    .set({ renderError })
    .where(and(eq(versions.id, versionId), eq(versions.workspaceId, workspaceId), isNull(versions.renderError)))
    .returning({ id: versions.id });
  return rows.length > 0;
}
