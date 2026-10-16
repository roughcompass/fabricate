import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { heroSlugOf, heroSnapshot } from "./heroes/use";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { type Reproducibility, type TemplateSnapshot, type TemplateStandards, prototypes, templateRechecks, templateVersions, templates, versions, workspaces } from "./db/schema";
import { CHECKS_VERSION, checkDigest } from "./gates";
import { PrototypesLimitError } from "./limits";
import { registryRelease } from "./salt/adapter";
import { KIT_VERSION } from "./salt-kit";
import { workspaceShell } from "./shell";
import { BRAND_IDS, type BrandId } from "./types";

/**
 * Accepting a page version as a template (versions spec, "A page version can
 * be accepted as a template" and "Template versions are immutable"). Each
 * acceptance publishes a template version with its own copy of the version,
 * the shell, the personas, the evidence, and what it was checked against, so
 * it outlives the prototype and the workspace and never changes. Templates
 * are shared by every workspace on the deployment, in the Salt Patterns
 * gallery.
 */

export type TemplateRow = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type TemplateRecheck = typeof templateRechecks.$inferSelect;
type Version = typeof versions.$inferSelect;

/** A live template with its versions, newest first, and the latest finished re-check of its latest version. */
export interface AcceptedTemplate extends TemplateRow {
  readonly latest: TemplateVersion;
  readonly versions: readonly TemplateVersion[];
  readonly recheck: TemplateRecheck | null;
}

export const TITLE_LENGTH = 80;
export const DESCRIPTION_LENGTH = 280;
export const TAG_LIMIT = 6;
export const TAG_LENGTH = 24;
export const DISPLAY_NAME_LENGTH = 60;
export const ANONYMOUS = "Anonymous visitor";
/** The size of the preview image the frame captures, and the most bytes it may take. */
export const PREVIEW_SIZE = { width: 1280, height: 800 } as const;
export const PREVIEW_BYTES = 1_500_000;

/** Attribution without sign-in is always marked unverified (versions spec, "Template attribution is shown as unverified"). */
export function attribution(acceptedBy: string): string {
  return `${acceptedBy} (unverified)`;
}

export type Eligibility = { readonly eligible: true } | { readonly eligible: false; readonly reason: string };

/** Whether a version can be accepted: a ready page version that passed every gate and has no serious or critical accessibility violation. Component scope is never offered. */
export function eligibility(version: Pick<Version, "scope" | "status" | "gatesPassed" | "audit" | "renderError">): Eligibility {
  if (version.scope !== "page") return { eligible: false, reason: "Only a page can be accepted as a template." };
  if (version.status !== "ready" || !version.gatesPassed) return { eligible: false, reason: "Its checks didn't pass." };
  if (version.renderError) return { eligible: false, reason: "It threw an error while rendering." };
  if (!version.audit) return { eligible: false, reason: "Its accessibility audit hasn't run yet. Open its preview to run it." };
  const blocking = version.audit.violations.find((violation) => violation.impact === "serious" || violation.impact === "critical");
  if (blocking) return { eligible: false, reason: `It has a ${blocking.impact} accessibility violation: ${blocking.help} (${blocking.rule}).` };
  return { eligible: true };
}

export interface AcceptanceInput {
  readonly title: string;
  readonly description: string;
  readonly brand: string;
  readonly tags: string;
  readonly displayName: string;
}

export interface Acceptance {
  readonly title: string;
  readonly description: string;
  readonly brand: BrandId;
  readonly tags: string[];
  readonly displayName: string | null;
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=\S)/).filter(Boolean).length;

export function validateAcceptance(input: AcceptanceInput): Acceptance {
  const issues = new IssueCollector();
  const title = input.title.trim().replace(/\s+/g, " ");
  const description = input.description.trim().replace(/\s+/g, " ");
  const tags = [...new Set(input.tags.split(",").map((tag) => tag.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const displayName = input.displayName.trim().replace(/\s+/g, " ");
  if (!title) issues.add("title", "Enter a title.");
  else if (title.length > TITLE_LENGTH) issues.add("title", `Use at most ${TITLE_LENGTH} characters.`);
  if (!description) issues.add("description", "Describe the template in a sentence or two.");
  else if (description.length > DESCRIPTION_LENGTH) issues.add("description", `Use at most ${DESCRIPTION_LENGTH} characters.`);
  else if (sentences(description) > 2) issues.add("description", "Use one or two sentences.");
  if (!BRAND_IDS.includes(input.brand as BrandId)) issues.add("brand", "Choose a brand.");
  if (tags.length === 0) issues.add("tags", "Add at least one tag.");
  else if (tags.length > TAG_LIMIT) issues.add("tags", `Use at most ${TAG_LIMIT} tags.`);
  else if (tags.some((tag) => tag.length > TAG_LENGTH)) issues.add("tags", `Keep each tag to ${TAG_LENGTH} characters.`);
  if (displayName.length > DISPLAY_NAME_LENGTH) issues.add("displayName", `Use at most ${DISPLAY_NAME_LENGTH} characters.`);
  issues.throwIfAny();
  return { title, description, brand: input.brand as BrandId, tags, displayName: displayName || null };
}

/** The PNG bytes of a captured data URL, or null when it isn't one or is too big. */
export function previewPng(dataUrl: string): Buffer | null {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  const bytes = Buffer.from(dataUrl.slice(prefix.length), "base64");
  // A PNG starts with its 8-byte signature.
  if (bytes.length > PREVIEW_BYTES || bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return bytes;
}

function slugFor(title: string, id: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "prototype";
  // The id's tail keeps it apart from every built-in slug and from other templates of the same title.
  return `${base}-${id.slice(-6)}`;
}

/**
 * Accepts a version as a template: the first acceptance of a prototype
 * publishes template version 1 of a new template, and each later one
 * publishes the next version of the same template. Nothing is updated in
 * place. +standards+ records what acceptance was held to: the Salt Patterns
 * Run and Evaluation the version met, or Not evaluated (template-conformance
 * spec). Returns the template and the version published.
 */
export async function acceptVersion(db: PrototypesExecutor, workspaceId: string, versionId: string, input: Acceptance, png: Buffer | null, now = new Date(), standards: TemplateStandards | null = null): Promise<{ template: TemplateRow; version: TemplateVersion }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ version: versions, prototype: prototypes })
      .from(versions)
      .innerJoin(prototypes, eq(prototypes.id, versions.prototypeId))
      .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, versionId)));
    const number = row?.version.number;
    if (!row || number == null || !row.version.provenance || !row.version.compiled) throw new NotFoundError("Unknown version");
    const { version, prototype } = row;
    const allowed = eligibility(version);
    if (!allowed.eligible) throw new PrototypesLimitError(allowed.reason);

    const [workspace] = await tx.select({ displayName: workspaces.displayName }).from(workspaces).where(eq(workspaces.id, workspaceId));
    // A display name given once is remembered for the workspace.
    if (input.displayName && input.displayName !== workspace?.displayName) await tx.update(workspaces).set({ displayName: input.displayName }).where(eq(workspaces.id, workspaceId));
    const gates = version.attempts.at(-1)?.gates ?? [];
    const snapshot: TemplateSnapshot = {
      versionId: version.id,
      number,
      prototypeName: prototype.name,
      code: version.code,
      sampleData: version.sampleData ?? null,
      compiled: version.compiled!,
      runtimeHash: version.runtimeHash ?? "",
      title: version.title,
      navItem: version.navItem,
      personas: version.provenance!.personas,
      provenance: version.provenance!,
      gates,
      attempts: version.attempts.length,
      audit: version.audit,
      fit: version.fit,
    };
    const reproducibility: Reproducibility = {
      saltRelease: version.provenance!.saltRelease,
      registryRelease: version.provenance!.registryRelease || registryRelease().release,
      kitVersion: version.provenance!.kitVersion || KIT_VERSION,
      checksVersion: CHECKS_VERSION,
      checkDigest: checkDigest(gates),
    };

    const [existing] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.prototypeId, prototype.id), eq(templates.workspaceId, workspaceId), isNull(templates.withdrawnAt)));
    let template: TemplateRow;
    if (existing) {
      // Claims the next version number in one conditional update.
      [template] = (await tx
        .update(templates)
        .set({ latestNumber: sql`${templates.latestNumber} + 1`, updatedAt: now })
        .where(eq(templates.id, existing.id))
        .returning()) as [TemplateRow];
    } else {
      const id = generatePublicId("ptp");
      [template] = (await tx.insert(templates).values({ id, slug: slugFor(input.title, id), workspaceId, prototypeId: prototype.id, latestNumber: 1, createdAt: now, updatedAt: now }).returning()) as [TemplateRow];
    }
    const [published] = await tx
      .insert(templateVersions)
      .values({
        id: generatePublicId("ptv"),
        templateId: template.id,
        number: template.latestNumber,
        workspaceId,
        acceptedBy: input.displayName ?? workspace?.displayName ?? ANONYMOUS,
        title: input.title,
        description: input.description,
        brand: input.brand,
        tags: input.tags,
        snapshot,
        shell: await workspaceShell(tx, workspaceId),
        previewPng: png,
        reproducibility,
        standards,
        acceptedAt: now,
      })
      .returning();
    return { template, version: published! };
  });
}

/** Withdraws a template the workspace accepted, which removes every version of it from the gallery. */
export async function withdrawTemplate(db: PrototypesExecutor, workspaceId: string, templateId: string, now = new Date()): Promise<TemplateRow> {
  const [template] = await db
    .update(templates)
    .set({ withdrawnAt: now, updatedAt: now })
    .where(and(eq(templates.id, templateId), eq(templates.workspaceId, workspaceId), isNull(templates.withdrawnAt)))
    .returning();
  if (!template) throw new NotFoundError("Unknown template");
  return template;
}

const { previewPng: _image, ...withoutImage } = getTableColumns(templateVersions);

/** The versions of these templates, newest first, without their stored images, which the preview route serves. */
async function versionsOfTemplates(db: PrototypesExecutor, templateIds: readonly string[]): Promise<TemplateVersion[]> {
  if (templateIds.length === 0) return [];
  const rows = await db
    .select(withoutImage)
    .from(templateVersions)
    .where(inArray(templateVersions.templateId, [...templateIds]))
    .orderBy(desc(templateVersions.number));
  return rows.map((row) => ({ ...row, previewPng: null }));
}

/** The latest finished re-check of each of these template versions. */
export async function latestRechecks(db: PrototypesExecutor, versionIds: readonly string[]): Promise<Map<string, TemplateRecheck>> {
  if (versionIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(templateRechecks)
    .where(and(inArray(templateRechecks.templateVersionId, [...versionIds]), isNotNull(templateRechecks.status)))
    .orderBy(asc(templateRechecks.finishedAt));
  // Later rows overwrite earlier ones, so each version keeps its latest.
  return new Map(rows.map((row) => [row.templateVersionId, row]));
}

async function assemble(db: PrototypesExecutor, rows: readonly TemplateRow[]): Promise<AcceptedTemplate[]> {
  const all = await versionsOfTemplates(db, rows.map((row) => row.id));
  const rechecks = await latestRechecks(db, all.map((version) => version.id));
  return rows.flatMap((row) => {
    const own = all.filter((version) => version.templateId === row.id);
    const latest = own[0];
    return latest ? [{ ...row, latest, versions: own, recheck: rechecks.get(latest.id) ?? null }] : [];
  });
}

/** Every live template accepted from a prototype on this deployment, most recently accepted first. */
export async function liveTemplates(db: PrototypesExecutor): Promise<AcceptedTemplate[]> {
  const rows = await db.select().from(templates).where(isNull(templates.withdrawnAt)).orderBy(desc(templates.updatedAt));
  return assemble(db, rows);
}

export async function templateBySlug(db: PrototypesExecutor, slug: string): Promise<AcceptedTemplate | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.slug, slug), isNull(templates.withdrawnAt)));
  return (await assemble(db, rows))[0] ?? null;
}

/** What a template version froze at acceptance, or a hero's page as one, or null when it no longer exists. */
export async function templateVersionSnapshot(db: PrototypesExecutor, templateVersionId: string): Promise<TemplateSnapshot | null> {
  const hero = heroSlugOf(templateVersionId);
  if (hero) return heroSnapshot(hero);
  const [row] = await db.select({ snapshot: templateVersions.snapshot }).from(templateVersions).where(eq(templateVersions.id, templateVersionId));
  return row?.snapshot ?? null;
}

/** The live template with this id, if any. */
export async function templateById(db: PrototypesExecutor, templateId: string): Promise<AcceptedTemplate | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), isNull(templates.withdrawnAt)));
  return (await assemble(db, rows))[0] ?? null;
}

/** The live template accepted from this prototype, if any. */
export async function liveTemplateFor(db: PrototypesExecutor, prototypeId: string): Promise<AcceptedTemplate | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.prototypeId, prototypeId), isNull(templates.withdrawnAt)));
  return (await assemble(db, rows))[0] ?? null;
}

/** A live template's latest version, with its image, for the preview route and the frame. */
export async function latestTemplateVersion(db: PrototypesExecutor, templateId: string): Promise<TemplateVersion | null> {
  const [row] = await db
    .select({ version: templateVersions })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(and(eq(templates.id, templateId), isNull(templates.withdrawnAt), eq(templateVersions.number, templates.latestNumber)));
  return row?.version ?? null;
}
