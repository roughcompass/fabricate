import { and, eq } from "drizzle-orm";
import { type PrototypesExecutor, getPrototypesDb } from "./db/client";
import { prototypes, templateVersions, versions } from "./db/schema";
import { type ExportedVersion, projectFiles } from "./export";
import { workspaceShell } from "./shell";

/**
 * The files a template assessment reads (template-conformance spec, "Accepting
 * a page version assesses its exported project"): the same project the
 * version's download contains, built by the one export generator. Before a
 * first acceptance that is the prototype version in its workspace's current
 * shell; afterward it is the template version as accepted, with the shell it
 * was accepted in, which outlives the workspace.
 */

/** A ready version as the download exports it, in its workspace's current shell; with +workspaceId+, only that workspace's. */
export async function exportedPrototypeVersion(db: PrototypesExecutor, versionId: string, workspaceId?: string): Promise<ExportedVersion | null> {
  const [row] = await db
    .select({ version: versions, name: prototypes.name })
    .from(versions)
    .innerJoin(prototypes, eq(prototypes.id, versions.prototypeId))
    .where(and(eq(versions.id, versionId), eq(versions.status, "ready"), ...(workspaceId ? [eq(versions.workspaceId, workspaceId)] : [])));
  if (!row || row.version.number == null) return null;
  const { version, name } = row;
  return {
    prototypeName: name,
    number: row.version.number,
    scope: version.scope,
    title: version.title,
    navItem: version.navItem,
    code: version.code,
    data: version.sampleData?.source ?? "export {};\n",
    styles: version.styles,
    personas: version.provenance?.personas ?? [],
    shell: await workspaceShell(db, version.workspaceId),
  };
}

/** A template version as it was accepted: a page, with the shell of its acceptance. */
export async function exportedTemplateVersion(db: PrototypesExecutor, templateVersionId: string): Promise<ExportedVersion | null> {
  const [row] = await db.select({ snapshot: templateVersions.snapshot, shell: templateVersions.shell }).from(templateVersions).where(eq(templateVersions.id, templateVersionId));
  if (!row) return null;
  const { snapshot, shell } = row;
  return {
    prototypeName: snapshot.prototypeName,
    number: snapshot.number,
    scope: "page",
    title: snapshot.title,
    navItem: snapshot.navItem,
    code: snapshot.code,
    data: snapshot.sampleData?.source ?? "export {};\n",
    styles: snapshot.styles ?? null,
    personas: snapshot.personas,
    shell,
  };
}

/** What a template target names: its template version once accepted, and always the prototype version. */
export interface TemplateFilesRef {
  readonly templateVersionPublicId: string | null;
  readonly prototypeVersionPublicId: string;
}

/** The exported files of a template target's version, or an error when the version is gone. */
export async function templateTargetFiles(ref: TemplateFilesRef, db?: PrototypesExecutor): Promise<Record<string, string>> {
  const executor = db ?? (await getPrototypesDb());
  const exported = ref.templateVersionPublicId ? await exportedTemplateVersion(executor, ref.templateVersionPublicId) : await exportedPrototypeVersion(executor, ref.prototypeVersionPublicId);
  if (!exported) throw new Error(`Version ${ref.templateVersionPublicId ?? ref.prototypeVersionPublicId} no longer exists`);
  return projectFiles(exported);
}
