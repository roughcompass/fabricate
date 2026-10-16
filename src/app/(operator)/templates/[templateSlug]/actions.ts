"use server";

import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { TemplateBrokenError, startFromTemplate } from "@/lib/prototypes/fork";
import { HeroUnavailableError, heroTemplate, startFromHero } from "@/lib/prototypes/heroes/use";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { prototypesRequest } from "@/lib/prototypes/request";
import { text } from "@/lib/web/form-data";

/** Starts a new prototype in the visitor's workspace from a template accepted from a prototype. */
export async function startFromTemplateAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const templateId = text(formData, "template", 40);
  const slug = text(formData, "slug", 200);
  if (!isPublicId(templateId, "ptp")) throw new NotFoundError("Unknown template");
  const { db, workspace } = await prototypesRequest();
  let prototypeId: string;
  try {
    prototypeId = await startFromTemplate(db, workspace.id, templateId);
  } catch (error) {
    if (error instanceof TemplateBrokenError) redirect(`/templates/${encodeURIComponent(slug)}?notice=broken`);
    if (error instanceof PrototypesLimitError) redirect(`/templates/${encodeURIComponent(slug)}?notice=limit`);
    throw error;
  }
  redirect(`/prototypes/${prototypeId}?notice=from-template`);
}

/** Use template on a hero: its main route as one page, copied into a new prototype without a model call (template-gallery spec, "Using a hero template"). */
export async function startFromHeroAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const slug = text(formData, "slug", 200);
  if (!heroTemplate(slug)) throw new NotFoundError("Unknown hero template");
  const { db, workspace } = await prototypesRequest();
  let prototypeId: string;
  try {
    prototypeId = await startFromHero(db, workspace.id, slug);
  } catch (error) {
    if (error instanceof PrototypesLimitError) redirect(`/templates/${encodeURIComponent(slug)}?notice=limit`);
    if (error instanceof HeroUnavailableError) notFound();
    throw error;
  }
  redirect(`/prototypes/${prototypeId}?notice=from-template`);
}
