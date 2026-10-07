import { asc, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { linesOfBusiness, ownershipAssertions, ownershipSupersessions, portals, applications, type OwnershipSource } from "@/lib/db/schema";

/** Persistence for ownership: applications, portals, Lines of Business, and the assertions about them. */

export type Application = typeof applications.$inferSelect;
export type Portal = typeof portals.$inferSelect;
export type LineOfBusiness = typeof linesOfBusiness.$inferSelect;
export type OwnershipAssertion = typeof ownershipAssertions.$inferSelect;

/** Letters, digits, dots, dashes, and underscores, starting with a letter or digit. */
export const SEAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A label as one value: trimmed, inner whitespace collapsed, lowercase. */
export function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A new Web Application. Its SEAL ID is metadata: another application may
 * carry the same one, and nothing finds or merges applications by it.
 */
export function createApplication(db: Executor, input: { sealId: string | null; name?: string | null }): Application {
  return db
    .insert(applications)
    .values({ publicId: generatePublicId("wap"), sealId: input.sealId?.trim() || null, name: input.name?.trim() || null, createdAt: new Date() })
    .returning()
    .get();
}

export function findApplication(db: Executor, publicId: string): Application | undefined {
  return db.select().from(applications).where(eq(applications.publicId, publicId)).get();
}

/** Every application carrying +sealId+, oldest first. More than one is normal. */
export function applicationsWithSealId(db: Executor, sealId: string): Application[] {
  return db.select().from(applications).where(eq(applications.sealId, sealId.trim())).orderBy(asc(applications.id)).all();
}

/** How an application reads to a person: its name with its SEAL ID beside it, or the SEAL ID alone. */
export function applicationLabel(application: { name: string | null; sealId: string | null }): string {
  if (!application.name) return application.sealId ?? "Unnamed application";
  return application.sealId ? `${application.name} (${application.sealId})` : application.name;
}

/** The portal named +label+, created as a pending candidate on first mention. */
export function ensurePortal(db: Executor, label: string): Portal {
  const key = labelKey(label);
  const found = db.select().from(portals).where(eq(portals.labelKey, key)).get();
  if (found) return found;
  return db.insert(portals).values({ publicId: generatePublicId("ptl"), label: label.trim().replace(/\s+/g, " "), labelKey: key, createdAt: new Date() }).returning().get();
}

/** The Line of Business named +label+, created as a pending candidate on first mention. */
export function ensureLineOfBusiness(db: Executor, label: string): LineOfBusiness {
  const key = labelKey(label);
  const found = db.select().from(linesOfBusiness).where(eq(linesOfBusiness.labelKey, key)).get();
  if (found) return found;
  return db.insert(linesOfBusiness).values({ publicId: generatePublicId("lob"), label: label.trim().replace(/\s+/g, " "), labelKey: key, createdAt: new Date() }).returning().get();
}

/** What an assertion says: its attribute fixes its subject and value. */
export type AssertionClaim =
  | { attribute: "application"; repository: number; application: number }
  | { attribute: "team"; application: number; team: string }
  | { attribute: "line_of_business"; application: number; lineOfBusiness: number }
  | { attribute: "portal"; application: number; portal: number; operation: "add" | "remove" }
  | { attribute: "owner"; portal: number; application: number }
  | { attribute: "host"; portal: number; repository: number };

/** Who says it, where it came from, and how far it can be trusted. */
export interface AssertionProvenance {
  providedBy: string;
  /** The person it's credited to, when someone else entered it. */
  attributedTo?: string | null;
  source: OwnershipSource;
  /** When a Bitbucket permission check verified the claimant; unverified when absent. */
  verifiedAt?: Date | null;
  /** When the DE Console was read; required for a DE Console import. */
  readAt?: Date | null;
  recordedAt?: Date;
  /** Earlier assertions about the same subject and attribute that this one replaces. */
  supersedes?: readonly number[];
}

export function recordAssertion(db: Executor, input: AssertionClaim & AssertionProvenance): OwnershipAssertion {
  const columns = (() => {
    switch (input.attribute) {
      case "application":
        return { operation: "set", subjectRepositorySourceId: input.repository, valueApplicationId: input.application } as const;
      case "team":
        return { operation: "set", subjectApplicationId: input.application, valueTeam: input.team.trim() } as const;
      case "line_of_business":
        return { operation: "set", subjectApplicationId: input.application, valueLineOfBusinessId: input.lineOfBusiness } as const;
      case "portal":
        return { operation: input.operation, subjectApplicationId: input.application, valuePortalId: input.portal } as const;
      case "owner":
        return { operation: "set", subjectPortalId: input.portal, valueApplicationId: input.application } as const;
      case "host":
        return { operation: "set", subjectPortalId: input.portal, valueRepositorySourceId: input.repository } as const;
    }
  })();
  const fromConsole = input.source === "de_console";
  return immediate(db, (tx) => {
    const assertion = tx
      .insert(ownershipAssertions)
      .values({
        publicId: generatePublicId("own"),
        attribute: input.attribute,
        ...columns,
        providedBy: input.providedBy.trim(),
        attributedTo: input.attributedTo?.trim() || null,
        source: input.source,
        verification: fromConsole ? "not_required" : input.verifiedAt ? "verified" : "unverified",
        verifiedAt: fromConsole ? null : (input.verifiedAt ?? null),
        readAt: fromConsole ? (input.readAt ?? null) : null,
        recordedAt: input.recordedAt ?? new Date(),
      })
      .returning()
      .get();
    for (const supersededId of input.supersedes ?? []) tx.insert(ownershipSupersessions).values({ assertionId: assertion.id, supersededId }).run();
    return assertion;
  });
}
