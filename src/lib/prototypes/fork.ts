import { and, eq, isNull } from "drizzle-orm";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { prototypes, type TemplateSnapshot, templateVersions, templates, versions } from "./db/schema";
import { PROTOTYPE_LIMIT, PrototypesLimitError } from "./limits";
import { NAME_LENGTH } from "./prototypes";
import { latestRechecks } from "./templates";
import type { Provenance } from "./types";
import { claimSlot } from "./workspace";

/**
 * Copying a version into a new prototype (versions spec, "Any version can be
 * forked"; template-gallery spec, "Using a template from a prototype"). The
 * copy is version 1 of its own prototype, with the source's code, data,
 * scope, personas, direction, and evidence, since the code is the same. No
 * model is called, and the source is never changed.
 */

type Version = typeof versions.$inferSelect;

/** What a copy takes from its source version. */
export type CopySource = Pick<Version, "scope" | "title" | "navItem" | "summary" | "code" | "styles" | "sampleData" | "compiled" | "runtimeHash" | "attempts" | "firstPass" | "gatesPassed" | "audit" | "fit" | "fitAverage"> & { readonly provenance: Provenance };

/** Inserts a new prototype at version 1 copied from `source`, recording where it came from. Returns the prototype's id. */
export async function copyIntoPrototype(
  tx: PrototypesExecutor,
  workspaceId: string,
  name: string,
  source: CopySource,
  origin: Pick<Provenance, "forkedFrom" | "startedFromTemplate">,
  now = new Date(),
): Promise<string> {
  await claimSlot(tx, workspaceId, "prototypeCount", PROTOTYPE_LIMIT, `A workspace can hold ${PROTOTYPE_LIMIT} prototypes. Delete one to make another.`);
  const prototypeId = generatePublicId("pro");
  await tx.insert(prototypes).values({ id: prototypeId, workspaceId, name: name.slice(0, NAME_LENGTH), scope: source.scope, latestNumber: 1, createdAt: now, updatedAt: now });
  const provenance: Provenance = { ...source.provenance, message: null, parentVersionId: null, forkedFrom: origin.forkedFrom, startedFromTemplate: origin.startedFromTemplate, createdAt: now.toISOString() };
  await tx.insert(versions).values({
    id: generatePublicId("ver"),
    workspaceId,
    prototypeId,
    number: 1,
    status: "ready",
    scope: source.scope,
    title: source.title,
    navItem: source.navItem,
    summary: source.summary,
    code: source.code,
    styles: source.styles,
    sampleData: source.sampleData,
    compiled: source.compiled,
    runtimeHash: source.runtimeHash,
    provenance,
    attempts: [...source.attempts],
    firstPass: source.firstPass,
    gatesPassed: source.gatesPassed,
    audit: source.audit,
    fit: source.fit,
    fitAverage: source.fitAverage,
    createdAt: now,
  });
  return prototypeId;
}

/** Forks a ready version of one of the workspace's prototypes into "<name> (fork)". Returns the new prototype's id. */
export async function forkVersion(db: PrototypesExecutor, workspaceId: string, versionId: string, now = new Date()): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ version: versions, prototype: prototypes })
      .from(versions)
      .innerJoin(prototypes, eq(prototypes.id, versions.prototypeId))
      .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, versionId)));
    const number = row?.version.number;
    if (!row || number == null) throw new NotFoundError("Unknown version");
    const { version, prototype } = row;
    if (version.status !== "ready" || !version.provenance) throw new PrototypesLimitError("Only a ready version can be forked.");
    const suffix = " (fork)";
    return copyIntoPrototype(
      tx,
      workspaceId,
      `${prototype.name.slice(0, NAME_LENGTH - suffix.length)}${suffix}`,
      { ...version, provenance: version.provenance },
      { forkedFrom: { prototypeId: prototype.id, prototypeName: prototype.name, versionId: version.id, number }, startedFromTemplate: null },
      now,
    );
  });
}

/** What a template's copy of its version gives a new prototype; repairs are kept as a count, with the last attempt's gates. */
export function fromSnapshot(snapshot: TemplateSnapshot): CopySource {
  const at = snapshot.provenance.createdAt;
  return {
    scope: "page",
    title: snapshot.title,
    navItem: snapshot.navItem,
    summary: "",
    code: snapshot.code,
    styles: snapshot.styles ?? null,
    sampleData: snapshot.sampleData ?? null,
    compiled: snapshot.compiled,
    runtimeHash: snapshot.runtimeHash,
    attempts: [{ number: Math.max(1, snapshot.attempts), gates: snapshot.gates, passed: true, at }],
    firstPass: null,
    gatesPassed: true,
    audit: snapshot.audit,
    fit: snapshot.fit,
    fitAverage: snapshot.fit?.average ?? null,
    provenance: snapshot.provenance,
  };
}

/**
 * Starts a new prototype in the visitor's workspace from a template's latest
 * version (versions spec, "Using a template records which template version it
 * started from"), copied from that version's own snapshot with its sample
 * data, so the template is unchanged. It is refused while the latest
 * version's re-check is Broken. Returns the prototype's id.
 */
export async function startFromTemplate(db: PrototypesExecutor, workspaceId: string, templateId: string, now = new Date()): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: templateVersions.id, number: templateVersions.number, title: templateVersions.title, snapshot: templateVersions.snapshot })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(and(eq(templates.id, templateId), isNull(templates.withdrawnAt), eq(templateVersions.number, templates.latestNumber)));
    if (!row) throw new NotFoundError("Unknown template");
    const recheck = (await latestRechecks(tx, [row.id])).get(row.id);
    if (recheck?.status === "broken") throw new TemplateBrokenError();
    // A re-check's compiled code is the one made for the current runtime build.
    const source = { ...fromSnapshot(row.snapshot), ...(recheck?.compiled ? { compiled: recheck.compiled, runtimeHash: recheck.runtimeHash } : {}) };
    return copyIntoPrototype(tx, workspaceId, row.title, source, { forkedFrom: null, startedFromTemplate: { templateId, title: row.title, templateVersion: row.number } }, now);
  });
}

/** Use template is unavailable while the template's latest version is Broken (versions spec). */
export class TemplateBrokenError extends PrototypesLimitError {
  override name = "TemplateBrokenError";

  constructor() {
    super("This template fails its checks on the current Salt release, so it can't be used until a fixed version is accepted.");
  }
}
