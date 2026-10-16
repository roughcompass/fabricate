import type { Metadata } from "next";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { Alert } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { getConfig } from "@/lib/config";
import { isPublicId } from "@/lib/db/ids";
import { param } from "@/components/ui/outcome-toast";
import { DEFAULT_VARIANTS, INTENT_LENGTH, TEMPLATE_VARIANT_CHOICES, VARIANT_CHOICES } from "@/lib/prototypes/limits";
import { templateById } from "@/lib/prototypes/templates";
import { heroSlugOf, heroTemplate } from "@/lib/prototypes/heroes/use";
import { matchingTemplates } from "@/lib/demo/gallery-templates";
import { templatesAvailable } from "@/lib/prototypes/guard";
import { generationConfigured } from "@/lib/prototypes/models";
import { listPersonas } from "@/lib/prototypes/personas";
import { prototypesRequest } from "@/lib/prototypes/request";
import { limitResetsAt, remainingToday } from "@/lib/prototypes/workspace";
import { generateAction } from "../actions";
import { Composer } from "./composer";

export const metadata: Metadata = { title: "New prototype" };

/**
 * New prototype: the composer, with the notices and today's remaining
 * generations (availability spec). `?template=` attaches a template, which
 * becomes variant 0 (generation spec, "A generation can start from a template").
 */
export default async function NewPrototypePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { db, workspace } = await prototypesRequest();
  const requested = param(query, "template");
  const accepted = isPublicId(requested, "ptp") ? await templateById(db, requested) : null;
  const hero = heroSlugOf(requested) ? heroTemplate(heroSlugOf(requested)!) : null;
  const template = accepted ? { id: accepted.id, title: accepted.latest.title, version: accepted.latest.number, href: `/templates/${accepted.slug}` } : hero ? { id: hero.id, title: hero.title, version: hero.version, href: `/templates/${hero.slug}` } : null;
  const intent = (param(query, "intent") ?? "").slice(0, INTENT_LENGTH.max);
  // Matching templates are offered only where the gallery exists, and not once one is attached.
  const matches = templatesAvailable() && !template ? await matchingTemplates(intent) : null;
  const settings = getConfig().prototypes;
  const personas = await listPersonas(db, workspace.id);
  const available = generationConfigured(settings);
  const remaining = remainingToday(workspace, settings.dailyVariantLimit);
  // The default count, or the largest that today's remaining generations allow.
  const choices: readonly number[] = template ? TEMPLATE_VARIANT_CHOICES : VARIANT_CHOICES;
  // The template, variant 0, uses none of today's generations.
  const charged = (count: number) => count - (template ? 1 : 0);
  const variants = charged(DEFAULT_VARIANTS) <= remaining ? DEFAULT_VARIANTS : ([...choices].reverse().find((count) => charged(count) <= remaining) ?? choices[0]!);

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[{ href: "/prototypes", label: "Prototypes" }]}
        title="New prototype"
        description="Say what a persona needs; DE FabLab generates Salt variants in different directions, checks each one, and lets you keep the ones that work."
        alerts={
          !available && (
            <Alert tone="warning" title="Generation isn't configured in this environment">
              No AI Gateway credential is set, so Generate is unavailable. Seeded prototypes, their checks, and their reviews still open.
            </Alert>
          )
        }
      />
      <AiNotice confidential />
      <Composer
        action={generateAction}
        matches={matches}
        initial={{ values: { intent, scope: "page", personas: [], variants: String(variants), template: template?.id ?? "" }, errors: {} }}
        attached={template}
        personas={personas.map((persona) => ({ id: persona.id, name: persona.name, role: persona.role, organizationType: persona.organizationType }))}
        remaining={remaining}
        limit={settings.dailyVariantLimit}
        available={available}
        resetsAt={`${limitResetsAt(new Date()).toISOString().slice(11, 16)} UTC`}
      />
    </Page>
  );
}
