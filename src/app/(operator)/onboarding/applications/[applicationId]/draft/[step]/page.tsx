import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
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
import { formatAbsolute } from "@/components/ui/time";
import { type ApplicationDraft, applicationName, childModules, inferRendering, placementCandidates, placementStatesOf, readApplicationDraft, sameSealApplications, silentEvidence, validateApplicationDraft } from "@/lib/onboarding/applications";
import { claimText } from "../../../claims";
import { getConfig } from "@/lib/config";
import { type EnvironmentCatalog, environmentCatalog, environmentLabel, inCatalogOrder } from "@/lib/onboarding/environments";
import { assetAccess, describeRendering, findAssets, findMicrofrontend } from "@/lib/onboarding/microfrontends";
import { draftOf } from "@/lib/onboarding/revisions";
import { portalCatalog } from "@/lib/onboarding/catalog";
import { governingRevision, portalRevisionView } from "@/lib/onboarding/portals";
import { rememberedActor } from "../../../../actor";
import { mfeHref, mfeStepHref, withOrigin } from "../../../../microfrontends/load";
import { saveApplicationStep, submitApplicationAction } from "../../../actions";
import { CompositionStep, IdentityStep, LaunchStep, type MfeOption, type PickerResult, PlacementsStep, type PortalOption, type RenderingView } from "../../../draft-forms";
import { APPLICATION_STEPS, type ApplicationStep, applicationCrumbs, applicationHref, applicationStepHref, applicationStepOf, applicationSteps, loadApplication } from "../../../load";
import { applicationOutcome } from "../../../outcomes";

type Params = Promise<{ applicationId: string; step: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { applicationId, step } = await params;
  const loaded = loadApplication(applicationId);
  const label = APPLICATION_STEPS.find((candidate) => candidate.id === step)?.label;
  return { title: loaded && label ? `${label} · ${applicationName(loaded.application)} · Web Applications` : "Web Application not found" };
}

const fieldId = (location: string) => location.replaceAll(".", "-");
/** Issues about a step, a whole list, or a launch target that has no one field. */
const NOTE_LOCATIONS = new Set(["launch", "children", "placements", "legacy"]);
/** Issues about one row as a whole, such as a child MFE's state, shown with the row. */
const ROW_FEEDBACK = /^(children|placements)\.(\d+)$/;
const SOURCE_LABELS = { mfe_contract: "Submitted MFE rendering metadata", studio: "Studio module type", cdaas: "CDaaS" } as const;

export default async function ApplicationDraftPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ applicationId, step }, query] = await Promise.all([params, searchParams]);
  const loaded = loadApplication(applicationId);
  if (!loaded || !APPLICATION_STEPS.some((candidate) => candidate.id === step)) notFound();
  const { db, application } = loaded;
  const draft = draftOf(db, "application", application.id);
  if (!draft) redirect(applicationHref(application.publicId));
  const current = step as ApplicationStep;
  const name = applicationName(application);
  const document = readApplicationDraft(draft);
  const catalog = environmentCatalog(db, { studioConfigured: getConfig().onboarding.studio !== null });
  const { issues } = validateApplicationDraft(db, application, document, new Date(), catalog);

  const errors: Record<string, string[]> = {};
  const notes: string[] = [];
  for (const issue of draft.lockVersion > 0 ? issues.filter((item) => item.severity === "blocking" && applicationStepOf(item.location) === current) : []) {
    const row = ROW_FEEDBACK.exec(issue.location);
    if (NOTE_LOCATIONS.has(issue.location) || issue.code.startsWith("migration.")) notes.push(issue.message);
    else if (row) (errors[`${row[1]}-${row[2]}-feedback`] ??= []).push(issue.message);
    const parts = fieldId(issue.location).split("-");
    for (let length = parts.length; length > 0; length--) (errors[parts.slice(0, length).join("-")] ??= []).push(issue.message);
  }

  const launch = document.launch;
  const initial: DraftFormState = {
    values: {
      actor: await rememberedActor(),
      name: document.name,
      ownerTeam: document.ownerTeam ?? "",
      sealId: document.sealId ?? "",
      "launch.kind": launch.kind ?? "",
      "launch.microfrontend": launch.microfrontend ?? "",
      "launch.mode": launch.mode ?? "",
      "launch.documentUrl": launch.documentUrl ?? "",
      "launch.moduleUrl": launch.moduleUrl ?? "",
      "launch.exportedModule": launch.exportedModule ?? "",
      "launch.manifestUrl": launch.manifestUrl ?? "",
      "launch.exposedModule": launch.exposedModule ?? "",
      "launch.integrity": launch.integrity ?? "",
      "launch.sandbox": launch.sandbox,
      "launch.permissions": launch.permissions,
      "children.rows": document.children.map((_, index) => String(index)),
      ...Object.fromEntries(
        document.children.flatMap((child, index) => [
          [`children.${index}.microfrontend`, child.microfrontend],
          [`children.${index}.mountKind`, child.mountKind ?? ""],
          [`children.${index}.mountKey`, child.mountKey],
          [`children.${index}.required`, child.required ? "on" : ""],
          [`children.${index}.module`, child.module ?? ""],
        ]),
      ),
      "placements.rows": document.placements.map((_, index) => String(index)),
      ...Object.fromEntries(
        document.placements.flatMap((placement, index) => [
          [`placements.${index}.placement`, placement.placement ?? ""],
          [`placements.${index}.portal`, placement.portal],
          [`placements.${index}.menuParent`, placement.menuParent ?? ""],
          [`placements.${index}.route`, placement.route],
          [`placements.${index}.label`, placement.label],
          [`placements.${index}.order`, String(placement.order)],
          [`placements.${index}.environments`, placement.environments],
          [`placements.${index}.codes`, placement.entitlements.codes.join("\n")],
          [`placements.${index}.operator`, placement.entitlements.operator],
          [`placements.${index}.defaultRequested`, placement.defaultRequested ? "on" : ""],
        ]),
      ),
    },
    errors,
    lockVersion: draft.lockVersion,
  };
  const action = saveApplicationStep.bind(null, application.publicId, current);
  const cancelHref = applicationHref(application.publicId);
  const label = APPLICATION_STEPS.find((candidate) => candidate.id === current)!.label;
  const key = `${current}-${draft.lockVersion}`;
  const props = { action, initial, cancelHref, notes };

  // MFEs an Application can bind: submitted, renderable, and not retired.
  const mfes: MfeOption[] = findAssets(db, "", 500).flatMap(({ microfrontend, rendering }) => (rendering ? [{ value: microfrontend.publicId, label: microfrontend.name, renders: describeRendering(rendering), modules: childModules(rendering) }] : []));
  const search = (param(query, "q") ?? "").trim().slice(0, 100);
  const bound = new Set(document.children.map((child) => child.microfrontend));
  const entryMfe = launch.kind === "mfe" ? launch.microfrontend : null;
  const picker: PickerResult[] = findAssets(db, search, 12).map(({ microfrontend, rendering, uses }) => {
    const access = assetAccess(document, microfrontend);
    const mfeDraft = draftOf(db, "microfrontend", microfrontend.id);
    return {
      value: microfrontend.publicId,
      label: microfrontend.name,
      team: microfrontend.ownerTeam,
      renders: rendering ? describeRendering(rendering) : "nothing until it's submitted",
      uses,
      unavailable: microfrontend.publicId === entryMfe ? "The launch target" : bound.has(microfrontend.publicId) ? "Already a child" : !rendering ? "Not submitted yet" : null,
      openHref: withOrigin(mfeHref(microfrontend.publicId), application.publicId),
      editHref: !access.editable ? null : withOrigin(mfeDraft ? mfeStepHref(microfrontend.publicId, "identity") : `${mfeHref(microfrontend.publicId)}?dialog=start-draft#dialog`, application.publicId),
      owner: access.reason,
    };
  });

  return (
    <Page width="form">
      <PageHeader breadcrumbs={[...applicationCrumbs, { href: cancelHref, label: name }]} title={label} meta={[`${name}, revision ${draft.number}`, "Draft"]} alerts={<OutcomeToast outcome={applicationOutcome(param(query, "notice"), application)} />} />
      <DraftSteps label={`Steps of revision ${draft.number}`} steps={applicationSteps(application.publicId, issues)} current={current} />
      {current === "identity" && <IdentityStep key={key} {...props} sameSeal={<SameSeal db={db} sealId={document.sealId?.trim() || null} except={application.id} />} history={history(document)} />}
      {current === "launch" && <LaunchStep key={key} {...props} mfes={mfes} rendering={renderingView(db, document)} />}
      {current === "composition" && (
        <>
          <Form key={search} action={applicationStepHref(application.publicId, "composition")} scroll={false} role="search" aria-label="Search shared MFEs">
            <SearchField id="mfe-search" name="q" label="Search shared MFEs" size="sm" placeholder="Search by name, team, SEAL ID, or CDaaS view" defaultValue={search} clearHref={applicationStepHref(application.publicId, "composition")} description="Finds MFEs to reuse below. Save first to keep other changes." />
          </Form>
          <CompositionStep
            key={key}
            {...props}
            mfes={mfes.filter((option) => option.value !== entryMfe)}
            entry={entryMfe ? (findMicrofrontend(db, entryMfe)?.name ?? null) : null}
            external={launch.kind === "external"}
            picker={{ search, results: picker, registerHref: `${applicationHref(application.publicId)}/microfrontends/new` }}
          />
        </>
      )}
      {current === "placements" && <PlacementsStep key={key} {...props} portals={portalOptions(db, catalog)} states={Object.fromEntries(placementStatesOf(db, application.id).map((state) => [state.placement, `${state.latest} in ${state.portalName} since revision ${state.revision}`]))} candidates={placementCandidates(db, application).map((candidate) => ({ portal: candidate.portal.publicId, label: candidate.portal.label, onboarded: candidate.portal.onboarded, claim: claimText(candidate) }))} />}
      {current === "review" && (
        <>
          <Section title="Validation" description="Every check of the whole Draft. Blocking issues stop submission; each links to where to fix it.">
            <ValidationIssues issues={issues} stepOf={(location) => ({ href: `${applicationStepHref(application.publicId, applicationStepOf(location))}#${fieldId(location)}`, label: APPLICATION_STEPS.find((candidate) => candidate.id === applicationStepOf(location))!.label })} />
          </Section>
          <SubmitForm key={key} action={submitApplicationAction.bind(null, application.publicId)} actor={await rememberedActor()} lockVersion={draft.lockVersion} number={draft.number} blocking={issues.filter((issue) => issue.severity === "blocking").length} cancelHref={cancelHref} />
        </>
      )}
    </Page>
  );
}

/** Other Applications sharing the SEAL ID, so the right one is edited. */
function SameSeal({ db, sealId, except }: { db: Parameters<typeof sameSealApplications>[0]; sealId: string | null; except: number }) {
  const others = sameSealApplications(db, sealId, except);
  if (others.length === 0) return null;
  return (
    <FormNote title={`${others.length === 1 ? "Another Application carries" : `${others.length} other Applications carry`} SEAL ID ${sealId}`}>
      <p>Each stays a separate record, with its own owner, composition, and placements.</p>
      <ul>
        {others.map((other) => (
          <li key={other.publicId}>
            <Link href={applicationHref(other.publicId)}>{applicationName(other)}</Link>
            {` · ${other.ownerTeam ? `owned by ${other.ownerTeam}` : "no owning team"} · ${other.publicId}`}
          </li>
        ))}
      </ul>
    </FormNote>
  );
}

function renderingView(db: Parameters<typeof inferRendering>[0], document: ReturnType<typeof readApplicationDraft>): RenderingView {
  const { candidates, agreed } = inferRendering(db, document.launch);
  const confirmation = document.confirmation;
  const stale = confirmation?.kind === "inferred" && !candidates.some((candidate) => candidate.key === confirmation.candidate);
  const launch = document.launch;
  const mfe = launch.kind === "mfe" && launch.microfrontend ? findMicrofrontend(db, launch.microfrontend) : undefined;
  return {
    candidates: candidates.map((candidate) => ({ key: candidate.key, mode: candidate.mode, module: candidate.module, location: candidate.location, source: SOURCE_LABELS[candidate.source], evidence: candidate.evidence, observed: formatAbsolute(candidate.observedAt) })),
    agreed,
    confirmation: confirmation && !stale ? { kind: confirmation.kind, by: confirmation.by, at: formatAbsolute(new Date(confirmation.at)), candidate: confirmation.candidate } : null,
    stale,
    unknown: silentEvidence(db, launch, new Date()),
    silence:
      candidates.length > 0
        ? null
        : launch.kind === "external"
          ? "An external endpoint is never fetched to guess its mode. Choose the mode, enter its values, and confirm them."
          : launch.kind === "mfe" && mfe
            ? `Nothing about ${mfe.name} proposes a mode yet, so choose one and confirm it.`
            : launch.kind === "mfe"
              ? "Choose the MFE and save: its submitted rendering metadata and Studio module type propose modes."
              : "Choose the launch target and save to see what the evidence proposes.",
  };
}

/** Portals that can take placements: onboarded and not retired, with their governing menu and the environments they enable. */
function portalOptions(db: Parameters<typeof portalCatalog>[0], catalog: EnvironmentCatalog): PortalOption[] {
  return portalCatalog(db)
    .filter((row) => row.portal.lifecycle !== "retired")
    .flatMap(({ portal }) => {
      const governing = governingRevision(db, portal);
      if (!governing) return [];
      const view = portalRevisionView(db, portal, governing);
      const enabled = inCatalogOrder(catalog, view.environments.filter((environment) => environment.enabled).map((environment) => environment.environment));
      return [{ value: portal.publicId, label: portal.label, menu: view.menu.map((group) => ({ key: group.key, label: group.label })), environments: enabled.map((key) => ({ key, label: environmentLabel(catalog, key) })) }];
    });
}

/** What a Draft converted from the earlier format kept: global environments, required capabilities, the external host contract, and child host settings. */
function history(document: ApplicationDraft) {
  if (!document.legacy) return null;
  const values = document.legacy.values as { environments?: string[]; requiredCapabilities?: string[]; hostContract?: unknown; hostConfiguration?: { microfrontend: string; hostConfiguration: unknown }[] };
  const items = [
    ...(values.environments?.length ? [["Environments", retained(values.environments.map((environment) => environment.toUpperCase()))] as const] : []),
    ...(values.requiredCapabilities?.length ? [["Required Portal capabilities", retained(values.requiredCapabilities)] as const] : []),
    ...(values.hostContract ? [["External host contract", retained(values.hostContract)] as const] : []),
    ...(values.hostConfiguration ?? []).map((entry) => [`Host settings for ${entry.microfrontend}`, retained(entry.hostConfiguration)] as const),
    ...("document" in document.legacy.values ? [["Earlier document", retained(document.legacy.values.document)] as const] : []),
  ];
  return <RetainedHistory legacy={document.legacy} items={items} replacement="Each placement now names the environments it appears in, and children are checked by their rendering metadata." />;
}
