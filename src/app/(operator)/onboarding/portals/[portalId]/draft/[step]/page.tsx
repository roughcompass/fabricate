import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { DraftFormState } from "@/components/onboarding/draft-form";
import { ValidationIssues } from "@/components/onboarding/issues";
import { RetainedHistory, retained } from "@/components/onboarding/legacy";
import { SubmitForm } from "@/components/onboarding/submit-form";
import { DraftSteps } from "@/components/onboarding/steps";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { formatAbsolute } from "@/components/ui/time";
import { getConfig } from "@/lib/config";
import { environmentCatalog } from "@/lib/onboarding/environments";
import type { PortalDocumentV1 } from "@/lib/onboarding/formats";
import { type PortalDraft, readPortalDraft, validatePortalDraft } from "@/lib/onboarding/portals";
import { draftOf } from "@/lib/onboarding/revisions";
import { rememberedActor } from "../../../../actor";
import { savePortalStep, submitPortalAction } from "../../../actions";
import { EnvironmentsStep, IdentityStep, MenuStep } from "../../../draft-forms";
import { PORTAL_STEPS, type PortalStep, fieldId, loadPortal, portalCrumbs, portalHref, portalStepOf, portalSteps, stepHref } from "../../../load";
import { portalOutcome } from "../../../outcomes";

type Params = Promise<{ portalId: string; step: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { portalId, step } = await params;
  const loaded = loadPortal(portalId);
  const label = PORTAL_STEPS.find((candidate) => candidate.id === step)?.label;
  return { title: loaded && label ? `${label} · ${loaded.portal.label} · Portals` : "Portal not found" };
}

/** A Portal Draft as the step forms show it: one value per field, rows by index. */
function formValues(draft: PortalDraft): DraftFormState["values"] {
  const values: DraftFormState["values"] = { ownerTeam: draft.ownerTeam ?? "", sealId: draft.sealId ?? "", environments: draft.environments };
  values["menu.rows"] = draft.menu.map((_, index) => String(index));
  draft.menu.forEach((group, index) => Object.assign(values, { [`menu.${index}.key`]: group.key, [`menu.${index}.label`]: group.label, [`menu.${index}.parent`]: group.parent ?? "", [`menu.${index}.order`]: String(group.order) }));
  return values;
}

/** What a Draft converted from the earlier format kept: the runtimes, each environment's runtime and entitlements, and the contract. */
function history(draft: PortalDraft) {
  if (!draft.legacy) return null;
  const values = draft.legacy.values as Partial<Pick<PortalDocumentV1, "runtimes" | "environments" | "contract">>;
  const environments = values.environments ?? [];
  const items = [
    ...(values.runtimes?.length ? [["Runtimes", retained(values.runtimes)] as const] : []),
    ...environments.map(
      (environment) =>
        [
          `${environment.key.toUpperCase()}${environment.enabled ? "" : " (disabled)"}`,
          [environment.runtime ? `Runtime ${environment.runtime}` : null, environment.inheritFrom ? `Entitlements inherited from ${environment.inheritFrom.toUpperCase()}` : environment.entitlements ? `Entitlements ${environment.entitlements.codes.join(", ") || "none"}, ${environment.entitlements.operator === "all" ? "all of them" : "any one"}` : null].filter(Boolean).join(" · ") || "Nothing else",
        ] as const,
    ),
    ...(values.contract && Object.keys(values.contract).length ? [["Contract", retained(values.contract)] as const] : []),
    ...("document" in draft.legacy.values ? [["Earlier document", retained(draft.legacy.values.document)] as const] : []),
  ];
  return <RetainedHistory legacy={draft.legacy} items={items} replacement="Environments are chosen from the catalog, and each placement's entitlements are decided when you review it." />;
}

export default async function PortalDraftPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ portalId, step }, query] = await Promise.all([params, searchParams]);
  const loaded = loadPortal(portalId);
  // Portals no longer have a contract step; its old address opens the first step, and the Draft keeps everything it holds.
  if (loaded && step === "contract") redirect(stepHref(loaded.portal.publicId, "identity"));
  if (!loaded || !PORTAL_STEPS.some((candidate) => candidate.id === step)) notFound();
  const { db, portal } = loaded;
  const draft = draftOf(db, "portal", portal.id);
  if (!draft) redirect(portalHref(portal.publicId));
  const current = step as PortalStep;
  const document = readPortalDraft(draft);
  const catalog = environmentCatalog(db, { studioConfigured: getConfig().onboarding.studio !== null });
  const { issues } = validatePortalDraft(document, catalog);
  const blocking = issues.filter((issue) => issue.severity === "blocking");
  // Each issue shows at its field: the closest one its location names. An issue about a whole list is a note on its step.
  const errors: Record<string, string[]> = {};
  const notes: string[] = [];
  // A Draft that's never been saved shows no issues at its fields yet; the step counts still say what's left.
  for (const issue of draft.lockVersion > 0 ? blocking.filter((item) => portalStepOf(item.location) === step) : []) {
    if (["environments", "menu", "legacy"].includes(issue.location) || issue.code.startsWith("migration.")) notes.push(issue.message);
    const parts = fieldId(issue.location).split("-");
    for (let length = parts.length; length > 0; length--) (errors[parts.slice(0, length).join("-")] ??= []).push(issue.message);
  }
  const initial: DraftFormState = { values: formValues(document), errors, lockVersion: draft.lockVersion };
  const action = savePortalStep.bind(null, portal.publicId, current);
  const cancelHref = portalHref(portal.publicId);
  const label = PORTAL_STEPS.find((candidate) => candidate.id === current)!.label;
  const key = `${current}-${draft.lockVersion}`;

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[...portalCrumbs, { href: portalHref(portal.publicId), label: portal.label }]}
        title={label}
        meta={[`${portal.label}, revision ${draft.number}`, "Draft"]}
        alerts={<OutcomeToast outcome={portalOutcome(param(query, "notice"), portal)} />}
      />
      <DraftSteps label={`Steps of revision ${draft.number}`} steps={portalSteps(portal.publicId, issues)} current={current} />
      {current === "identity" && <IdentityStep key={key} action={action} initial={initial} cancelHref={cancelHref} notes={notes} history={history(document)} />}
      {current === "environments" && (
        <EnvironmentsStep
          key={key}
          action={action}
          initial={initial}
          cancelHref={cancelHref}
          notes={notes}
          catalog={catalog.environments.map((environment) => ({ key: environment.key, label: environment.label }))}
          provenance={{ source: catalog.source, observed: catalog.observedAt ? formatAbsolute(catalog.observedAt) : null, stale: catalog.stale, note: catalog.note }}
        />
      )}
      {current === "menu" && <MenuStep key={key} action={action} initial={initial} cancelHref={cancelHref} notes={notes} />}
      {current === "review" && (
        <>
          <Section title="Validation" description="Every check of the whole Draft. Blocking issues stop submission; each links to where to fix it.">
            <ValidationIssues issues={issues} stepOf={(location) => ({ href: `${stepHref(portal.publicId, portalStepOf(location))}#${fieldId(location)}`, label: PORTAL_STEPS.find((candidate) => candidate.id === portalStepOf(location))!.label })} />
          </Section>
          <SubmitForm key={key} action={submitPortalAction.bind(null, portal.publicId)} actor={await rememberedActor()} lockVersion={draft.lockVersion} number={draft.number} blocking={blocking.length} cancelHref={cancelHref} />
        </>
      )}
    </Page>
  );
}
