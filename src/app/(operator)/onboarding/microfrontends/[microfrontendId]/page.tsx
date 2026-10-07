import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CurrentState } from "@/components/onboarding/current-state";
import { ActorDialog, ReasonDialog, ReferenceDialog } from "@/components/onboarding/dialogs";
import { LifecycleHistory } from "@/components/onboarding/history";
import { ReferencesTable } from "@/components/onboarding/references";
import { RevisionsTable } from "@/components/onboarding/revisions";
import { RuntimeContractSummary } from "@/components/onboarding/runtime-contract";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { repositorySources } from "@/lib/db/schema";
import { microfrontendState } from "@/lib/onboarding/external/current-state";
import { evidenceOf } from "@/lib/onboarding/external/evidence";
import { RECONCILIATION_LABELS } from "@/lib/onboarding/external/reconcile";
import { referenceOf, referencesOf } from "@/lib/onboarding/external/references";
import { describeRendering, microfrontendHistory, microfrontendReadiness, microfrontendSummary, microfrontendUses } from "@/lib/onboarding/microfrontends";
import { runtimeContractSchema } from "@/lib/onboarding/documents";
import { revisionsOf } from "@/lib/onboarding/revisions";
import { rememberedActor } from "../../actor";
import { addMicrofrontendReferenceAction, refreshMicrofrontendAction, removeMicrofrontendReferenceAction, retireMicrofrontendAction, startMicrofrontendDraftAction } from "../actions";
import { loadMicrofrontend, mfeCrumbsFor, mfeHref, mfeStepHref, originOf, withOrigin } from "../load";
import { mfeOutcome } from "../outcomes";

type Params = Promise<{ microfrontendId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadMicrofrontend((await params).microfrontendId);
  return { title: loaded ? `${loaded.microfrontend.name} · MFEs` : "MFE not found" };
}

const CHECK_STATES = { pass: "pass", fail: "fail", unknown: "unknown", stale: "stale" } as const;

export default async function MicrofrontendPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ microfrontendId }, query] = await Promise.all([params, searchParams]);
  const loaded = loadMicrofrontend(microfrontendId);
  if (!loaded) notFound();
  const { db, microfrontend: mfe } = loaded;
  const origin = originOf(param(query, "from"));
  const from = origin?.publicId ?? null;
  const base = mfeHref(mfe.publicId);
  const here = withOrigin(base, from);
  const { draft, latest, row } = microfrontendSummary(db, mfe);
  const readiness = microfrontendReadiness(db, mfe);
  const uses = microfrontendUses(db, mfe.id);
  const actor = await rememberedActor();
  const dialog = param(query, "dialog");
  const retired = mfe.lifecycle === "retired";
  const repository = row?.repositorySourceId ? db.select().from(repositorySources).where(eq(repositorySources.id, row.repositorySourceId)).get() : undefined;
  const view = referenceOf(db, { kind: "microfrontend", id: mfe.id }, "cdaas", "application_view");
  const observation = view ? evidenceOf(db, view).observation : null;
  const versions = observation?.outcome === "found" ? ((observation.projectionValue?.versions as { name: string; live: boolean; gitCommitHash: string | null; branch: string | null; buildNumber: string | null; lastModified: string | null }[] | undefined) ?? []) : [];
  const references = referencesOf(db, { kind: "microfrontend", id: mfe.id });

  const startDraft = (inline = false) => (
    <ActorDialog
      id="start-draft"
      action={startMicrofrontendDraftAction.bind(null, mfe.publicId, from)}
      title={`Start a Draft of ${mfe.name}?`}
      description={latest ? `The Draft starts from revision ${latest.number}, which stays as submitted until the Draft is.` : "The Draft holds the MFE's details until you submit it."}
      confirmLabel="Start Draft"
      actor={actor}
      trigger={{ label: "Start a Draft", icon: "edit", variant: "primary" }}
      fallbackHref={withOrigin(`${mfeHref(mfe.publicId)}?dialog=start-draft#dialog`, from)}
      inline={inline}
      cancelHref={here}
    />
  );
  const retire = (inline = false) => (
    <ReasonDialog
      id="retire"
      action={retireMicrofrontendAction.bind(null, mfe.publicId)}
      fields={{ lockVersion: String(mfe.lockVersion) }}
      title={`Retire ${mfe.name}?`}
      description="A retired MFE can't be used by any Application, and frees its CDaaS view for another MFE. Its revisions and history stay. Remove it from every Application first."
      confirmLabel="Retire MFE"
      tone="danger"
      actor={actor}
      trigger={{ label: "Retire", icon: "trash" }}
      fallbackHref={withOrigin(`${mfeHref(mfe.publicId)}?dialog=retire#dialog`, from)}
      inline={inline}
      cancelHref={here}
    />
  );
  const reference = (inline = false) => (
    <ReferenceDialog
      id="reference"
      action={addMicrofrontendReferenceAction.bind(null, mfe.publicId)}
      title={`Map ${mfe.name} to a Studio module`}
      description="State the Studio module that represents this MFE. Its type can then propose how Applications render it."
      confirmLabel="Save mapping"
      actor={actor}
      trigger={{ label: "Add mapping", icon: "link" }}
      fallbackHref={withOrigin(`${mfeHref(mfe.publicId)}?dialog=reference#dialog`, from)}
      inline={inline}
      cancelHref={withOrigin(`${mfeHref(mfe.publicId)}#references`, from)}
      resourceTypes={[{ value: "module", label: "Studio module" }]}
    />
  );
  const inlineDialog = dialog === "start-draft" && !draft && !retired ? startDraft(true) : dialog === "retire" && !retired ? retire(true) : dialog === "reference" ? reference(true) : null;
  const rendering = readiness.rendering;
  const earlierContract = row && row.formatVersion === 1 && row.contract ? runtimeContractSchema.safeParse(JSON.parse(row.contract)) : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={mfeCrumbsFor(origin)}
        title={mfe.name}
        status={<Status state={mfe.lifecycle} />}
        meta={[mfe.ownerTeam ? `Owned by ${mfe.ownerTeam}` : "No owning team yet", mfe.sealId ? `SEAL ID ${mfe.sealId}` : "No SEAL ID"]}
        primaryAction={retired ? undefined : draft ? <ButtonLink href={withOrigin(mfeStepHref(mfe.publicId, "identity"), from)} variant="primary" icon="edit">{`Continue revision ${draft.number}`}</ButtonLink> : startDraft()}
        extraActions={retired ? undefined : retire()}
        alerts={
          <>
            <OutcomeToast outcome={mfeOutcome(param(query, "notice"), mfe)} />
            {retired && <Alert title={`${mfe.name} is retired`}>No Application can use it. Its revisions and history stay below.</Alert>}
          </>
        }
      />
      {inlineDialog && <div id="dialog">{inlineDialog}</div>}

      <DescriptionList
        layout="columns"
        surface
        items={[
          ["Lifecycle", <Status key="lifecycle" state={mfe.lifecycle} />],
          ["Built from", repository ? `${repository.name}${row?.workspacePath ? ` · ${row.workspacePath}` : ""}` : "Not submitted yet"],
          ["CDaaS view", mfe.cdaasAppId ? <Tag key="view" label="CDaaS view">{`${mfe.cdaasAppId}/${mfe.cdaasViewId}`}</Tag> : "Not named"],
          ["CDaaS confirmation", <Status key="cdaas" state={readiness.cdaas.state} label={RECONCILIATION_LABELS[readiness.cdaas.state]} />],
          ["Submitted revision", latest ? <Link href={withOrigin(`${base}/revisions/${latest.number}`, from)}>{`Revision ${latest.number}`}</Link> : "None yet"],
          ["Draft", draft ? <Link href={withOrigin(mfeStepHref(mfe.publicId, "identity"), from)}>{`Revision ${draft.number}`}</Link> : "None"],
          ["Renders through", rendering ? describeRendering(rendering) : "Not submitted yet"],
        ]}
      />

      <Section title="Readiness" description="An MFE is Ready when its submitted revision is complete and CDaaS confirms its view now.">
        <Panel flush>
          <Table
            label="Readiness checks"
            head={
              <>
                <Th>Check</Th>
                <Th>Result</Th>
              </>
            }
          >
            {readiness.checks.map((check) => (
              <tr key={check.code}>
                <Td label="Check">
                  {check.label}
                  <Secondary>{check.message}</Secondary>
                </Td>
                <Td label="Result">
                  <Status state={CHECK_STATES[check.state]} label={check.state === "pass" ? "Passes" : check.state === "fail" ? "Fails" : RECONCILIATION_LABELS[check.state]} />
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>

      <div id="current-state">
        <CurrentState items={microfrontendState(db, mfe)} refresh={retired ? undefined : refreshMicrofrontendAction.bind(null, mfe.publicId)} />
      </div>

      <Section title="Observed versions" description="What CDaaS last reported for the view: release data, never part of the MFE's identity. Onboarding uploads, promotes, and selects nothing.">
        {versions.length > 0 && readiness.cdaas.state !== "matching" && (
          <Alert tone="warning" title={`Not confirmed: ${RECONCILIATION_LABELS[readiness.cdaas.state]}`}>
            {readiness.cdaas.reason}
          </Alert>
        )}
        <Panel flush>
          {versions.length > 0 ? (
            <>
              <Table
                label="Observed versions"
                head={
                  <>
                    <Th>Version</Th>
                    <Th>Built</Th>
                    <Th>Live</Th>
                  </>
                }
              >
                {versions.map((version) => (
                  <tr key={version.name}>
                    <Td label="Version">
                      <Tag label="version">{version.name}</Tag>
                    </Td>
                    <Td label="Built">
                      {[version.branch, version.buildNumber && `build ${version.buildNumber}`].filter(Boolean).join(", ") || "—"}
                      {version.gitCommitHash && <Secondary mono>{version.gitCommitHash}</Secondary>}
                    </Td>
                    <Td label="Live">{version.live ? <Status state="active" label="Live" /> : "No"}</Td>
                  </tr>
                ))}
              </Table>
            </>
          ) : (
            <EmptyState title="No versions observed">{observation ? `CDaaS's latest answer: ${RECONCILIATION_LABELS[readiness.cdaas.state]}.` : "CDaaS hasn't been read for this view yet."}</EmptyState>
          )}
        </Panel>
        {observation && (
          <Secondary>
            {"Observed "}
            <RelativeTime value={observation.observedAt} />
          </Secondary>
        )}
      </Section>

      <Section title="Used by" description="The Web Applications whose current revision binds this MFE, each with the role and mount it gives it.">
        <Panel flush>
          {uses.length > 0 ? (
            <Table
              label="Used by"
              head={
                <>
                  <Th>Application</Th>
                  <Th>Role</Th>
                  <Th>Mount</Th>
                </>
              }
            >
              {uses.map((use) => (
                <tr key={use.application.publicId}>
                  <Td label="Application">
                    <Primary>
                      <Link href={`/onboarding/applications/${use.application.publicId}`}>{use.application.name ?? use.application.publicId}</Link>
                    </Primary>
                    <Secondary>{`Revision ${use.revision} · ${use.launchKind === "mfe" ? "Launches a registered MFE" : "Launches an external endpoint"}`}</Secondary>
                  </Td>
                  <Td label="Role">{use.role === "entry" ? "Entry: the Application's launch target" : "Child"}</Td>
                  <Td label="Mount">{use.mount ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="Not used yet">Web Applications bind it as their launch target or as a child.</EmptyState>
          )}
        </Panel>
      </Section>

      {earlierContract?.success && (
        <Section title="Contract" description={`Revision ${latest?.number} was written in the earlier format, with this runtime contract. Its exports give the rendering metadata above; the rest is kept as history and checks nothing.`}>
          <RuntimeContractSummary contract={earlierContract.data} />
        </Section>
      )}

      <Section title="Revisions" description="Each submitted revision is frozen; edits start a new Draft.">
        <RevisionsTable revisions={revisionsOf(db, "microfrontend", mfe.id)} href={(number) => withOrigin(`${base}/revisions/${number}`, from)} active={mfe.activeRevisionId} draftHref={withOrigin(mfeStepHref(mfe.publicId, "identity"), from)} />
      </Section>

      <Section id="references" title="Mappings" description="The Studio module and CDaaS view this MFE is mapped to. Its CDaaS view comes from its submitted revision." actions={!retired && reference()}>
        <ReferencesTable references={references} remove={(item) => (item.source === "person" && !retired ? removeMicrofrontendReferenceAction.bind(null, mfe.publicId, item.publicId) : null)} />
      </Section>

      <Section title="History" description="Each change, with who made it as they stated it.">
        <LifecycleHistory events={microfrontendHistory(db, mfe.id)} />
      </Section>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["ID", <Tag key="id" copy label="ID">{mfe.publicId}</Tag>],
            ["Created", <RelativeTime key="created" value={mfe.createdAt} />],
            ...(row?.contractDigest ? ([["Contract digest", <Tag key="digest" copy label="contract digest">{row.contractDigest}</Tag>]] as const) : []),
            ...(draft ? ([["Draft version", draft.lockVersion]] as const) : []),
          ]}
        />
      </Disclosure>
    </Page>
  );
}
