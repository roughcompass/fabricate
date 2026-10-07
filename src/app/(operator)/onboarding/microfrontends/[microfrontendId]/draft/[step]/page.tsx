import type { Metadata } from "next";
import Form from "next/form";
import { notFound, redirect } from "next/navigation";
import type { DraftFormState } from "@/components/onboarding/draft-form";
import { ValidationIssues } from "@/components/onboarding/issues";
import { RetainedHistory, retained } from "@/components/onboarding/legacy";
import { DraftSteps } from "@/components/onboarding/steps";
import { SubmitForm } from "@/components/onboarding/submit-form";
import { FormNote } from "@/components/ui/form";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { SearchField } from "@/components/ui/search-field";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { findSource, listSources } from "@/lib/catalog/source-records";
import { RECONCILIATION_LABELS } from "@/lib/onboarding/external/reconcile";
import { type MicrofrontendDraft, microfrontendReadiness, readMicrofrontendDraft, validateMicrofrontendDraft } from "@/lib/onboarding/microfrontends";
import { RenderingEvidence } from "./rendering-evidence";
import { draftOf } from "@/lib/onboarding/revisions";
import { rememberedActor } from "../../../../actor";
import { saveMicrofrontendStep, submitMicrofrontendAction } from "../../../actions";
import { CdaasStep, IdentityStep, RenderingStep, SourceStep } from "../../../draft-forms";
import { MFE_STEPS, type MfeStep, loadMicrofrontend, mfeCrumbsFor, mfeHref, mfeStepHref, mfeStepOf, mfeSteps, originOf, withOrigin } from "../../../load";
import { mfeOutcome } from "../../../outcomes";

type Params = Promise<{ microfrontendId: string; step: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { microfrontendId, step } = await params;
  const loaded = loadMicrofrontend(microfrontendId);
  const label = MFE_STEPS.find((candidate) => candidate.id === step)?.label;
  return { title: loaded && label ? `${label} · ${loaded.microfrontend.name} · MFEs` : "MFE not found" };
}

const fieldId = (location: string) => location.replaceAll(".", "-");

/** What a Draft converted from the earlier format kept: the runtime contract, whose exports became rendering metadata where they could. */
function history(document: MicrofrontendDraft) {
  if (!document.legacy) return null;
  const contract = document.legacy.values.contract as { exports?: { name: string; modes: string[] }[]; requires?: unknown; provides?: unknown; shared?: unknown } | undefined;
  const items = [
    ...(contract?.exports?.length ? [["Exports", contract.exports.map((entry) => `${entry.name} (${entry.modes.join(", ")})`).join("; ")] as const] : []),
    ...(contract?.requires ? [["Required of its host", retained(contract.requires)] as const] : []),
    ...(contract?.provides ? [["Provided to children", retained(contract.provides)] as const] : []),
    ...(contract?.shared ? [["Shared dependencies", retained(contract.shared)] as const] : []),
    ...("document" in document.legacy.values ? [["Earlier document", retained(document.legacy.values.document)] as const] : []),
  ];
  return <RetainedHistory legacy={document.legacy} items={items} replacement="The rendering step says how each mode loads it now." />;
}

export default async function MicrofrontendDraftPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ microfrontendId, step }, query] = await Promise.all([params, searchParams]);
  const loaded = loadMicrofrontend(microfrontendId);
  const origin = originOf(param(query, "from"));
  const from = origin?.publicId ?? null;
  // MFEs no longer have a contract step; its old address opens the rendering step, and the Draft keeps everything it holds.
  if (loaded && step === "contract") redirect(withOrigin(mfeStepHref(loaded.microfrontend.publicId, "rendering"), from));
  if (!loaded || !MFE_STEPS.some((candidate) => candidate.id === step)) notFound();
  const { db, microfrontend: mfe } = loaded;
  const draft = draftOf(db, "microfrontend", mfe.id);
  if (!draft) redirect(withOrigin(mfeHref(mfe.publicId), from));
  const current = step as MfeStep;
  const document = readMicrofrontendDraft(draft);
  const { issues } = validateMicrofrontendDraft(db, mfe, document);
  const errors: Record<string, string[]> = {};
  const notes: string[] = [];
  for (const issue of draft.lockVersion > 0 ? issues.filter((item) => item.severity === "blocking" && mfeStepOf(item.location) === current) : []) {
    if (["cdaas", "rendering", "rendering.iframe", "legacy"].includes(issue.location) || issue.code.startsWith("migration.")) notes.push(issue.message);
    const parts = fieldId(issue.location).split("-");
    for (let length = parts.length; length > 0; length--) (errors[parts.slice(0, length).join("-")] ??= []).push(issue.message);
  }
  const initial: DraftFormState = {
    values: {
      name: document.name,
      ownerTeam: document.ownerTeam ?? "",
      sealId: document.sealId ?? "",
      repository: document.repository ?? "",
      workspacePath: document.workspacePath ?? "",
      "cdaas.appId": document.cdaas?.appId ?? "",
      "cdaas.viewId": document.cdaas?.viewId ?? "",
      "rendering.iframe.enabled": document.rendering.iframe ? "on" : "",
      "rendering.iframe.entry": document.rendering.iframe?.entry ?? "",
      "rendering.esm.enabled": document.rendering.esm ? "on" : "",
      "rendering.esm.exports": (document.rendering.esm?.exports ?? []).join("\n"),
      "rendering.module_federation_2.enabled": document.rendering.module_federation_2 ? "on" : "",
      "rendering.module_federation_2.exposes": (document.rendering.module_federation_2?.exposes ?? []).join("\n"),
    },
    errors,
    lockVersion: draft.lockVersion,
  };
  const action = saveMicrofrontendStep.bind(null, mfe.publicId, current, from);
  const cancelHref = origin ? origin.compositionHref : mfeHref(mfe.publicId);
  const label = MFE_STEPS.find((candidate) => candidate.id === current)!.label;
  const key = `${current}-${draft.lockVersion}`;
  const search = (param(query, "q") ?? "").trim().slice(0, 100);
  const needle = search.toLowerCase();
  const chosen = document.repository ? findSource(db, document.repository) : undefined;
  // The chosen Repository stays listed even when it's disabled, so saving another step never drops it.
  const repositories = listSources(db)
    .filter((source) => source.publicId === document.repository || (source.enabled && (!needle || source.name.toLowerCase().includes(needle) || source.cloneUrl.toLowerCase().includes(needle))))
    .slice(0, 500)
    .map((source) => ({ value: source.publicId, label: source.enabled ? source.name : `${source.name} (disabled)` }));
  if (current === "source" && repositories.length === 0) notes.push(...(errors.repository ?? []));
  const readiness = microfrontendReadiness(db, mfe);

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[...mfeCrumbsFor(origin), { href: withOrigin(mfeHref(mfe.publicId), from), label: mfe.name }]}
        title={label}
        meta={[`${mfe.name}, revision ${draft.number}`, "Draft", ...(origin ? [`Returns to ${origin.name}'s composition`] : [])]}
        alerts={<OutcomeToast outcome={mfeOutcome(param(query, "notice"), mfe)} />}
      />
      <DraftSteps label={`Steps of revision ${draft.number}`} steps={mfeSteps(mfe.publicId, issues, from)} current={current} />
      {current === "identity" && <IdentityStep key={key} action={action} initial={initial} cancelHref={cancelHref} notes={notes} history={history(document)} />}
      {current === "source" && (
        <>
          <Form key={search} action={mfeStepHref(mfe.publicId, "source")} scroll={false} role="search" aria-label="Search Repositories">
            {from && <input type="hidden" name="from" value={from} />}
            <SearchField id="repository-search" name="q" label="Search Repositories" size="sm" placeholder="Search by name or clone URL" defaultValue={search} clearHref={withOrigin(mfeStepHref(mfe.publicId, "source"), from)} description="Narrows the Repository list below. Save first to keep other changes." />
          </Form>
          <SourceStep key={key} action={action} initial={initial} cancelHref={cancelHref} notes={notes} repositories={repositories} search={search} chosen={chosen ? { name: chosen.name, enabled: chosen.enabled, href: `/repositories?${new URLSearchParams({ status: "disabled", q: chosen.name })}` } : null} />
        </>
      )}
      {current === "cdaas" && (
        <CdaasStep
          key={key}
          action={action}
          initial={initial}
          cancelHref={cancelHref}
          notes={notes}
          confirmation={
            <FormNote title="Confirmation" icon={readiness.cdaas.state === "matching" ? "checkCircle" : "info"}>
              <p>
                <Status state={readiness.cdaas.state} label={RECONCILIATION_LABELS[readiness.cdaas.state]} />
              </p>
              <p>{mfe.cdaasAppId ? `For the submitted view ${mfe.cdaasAppId}/${mfe.cdaasViewId}: ${readiness.cdaas.reason}.` : "Reconciliation reads the view once a revision naming it is submitted. Only a confirmed view makes the MFE Ready."}</p>
            </FormNote>
          }
        />
      )}
      {current === "rendering" && (
        <>
          <RenderingStep key={key} action={action} initial={initial} cancelHref={cancelHref} notes={notes} />
          <RenderingEvidence mfe={mfe} document={document} />
        </>
      )}
      {current === "review" && (
        <>
          <Section title="Validation" description="Every check of the whole Draft. Blocking issues stop submission; each links to where to fix it.">
            <ValidationIssues issues={issues} stepOf={(location) => ({ href: withOrigin(`${mfeStepHref(mfe.publicId, mfeStepOf(location))}#${fieldId(location)}`, from), label: MFE_STEPS.find((candidate) => candidate.id === mfeStepOf(location))!.label })} />
          </Section>
          <SubmitForm key={key} action={submitMicrofrontendAction.bind(null, mfe.publicId, from)} actor={await rememberedActor()} lockVersion={draft.lockVersion} number={draft.number} blocking={issues.filter((issue) => issue.severity === "blocking").length} cancelHref={cancelHref} />
        </>
      )}
    </Page>
  );
}
