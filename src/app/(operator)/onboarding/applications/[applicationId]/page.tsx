import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CurrentState } from "@/components/onboarding/current-state";
import { ActorDialog, ReasonDialog, ReferenceDialog } from "@/components/onboarding/dialogs";
import { LifecycleHistory } from "@/components/onboarding/history";
import { ReferencesTable } from "@/components/onboarding/references";
import { RevisionsTable } from "@/components/onboarding/revisions";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
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
import { applicationHistory, applicationName, applicationReadiness, applicationRevisionView, applicationSummary, compositionOutline, placementCandidates, placementStatesOf, sameSealApplications } from "@/lib/onboarding/applications";
import { RENDERING_MODE_LABELS } from "@/lib/onboarding/documents";
import { applicationState } from "@/lib/onboarding/external/current-state";
import { RECONCILIATION_LABELS } from "@/lib/onboarding/external/reconcile";
import { referencesOf } from "@/lib/onboarding/external/references";
import { revisionsOf } from "@/lib/onboarding/revisions";
import { rememberedActor } from "../../actor";
import { addApplicationReferenceAction, refreshApplicationAction, removeApplicationReferenceAction, retireApplicationAction, startApplicationDraftAction } from "../actions";
import { applicationCrumbs, applicationHref, applicationStepHref, loadApplication } from "../load";
import { claimText } from "../claims";
import { applicationOutcome } from "../outcomes";

type Params = Promise<{ applicationId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadApplication((await params).applicationId);
  return { title: loaded ? `${applicationName(loaded.application)} · Web Applications` : "Web Application not found" };
}

const CHECK_STATES = { pass: "pass", fail: "fail", unknown: "unknown", stale: "stale" } as const;
const CONFIRMED = { inferred: "confirmed from the evidence", override: "chosen over the inferred mode", explicit: "chosen explicitly" } as const;
const STATE_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", retired: "Retired" } as const;

export default async function ApplicationPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ applicationId }, query] = await Promise.all([params, searchParams]);
  const loaded = loadApplication(applicationId);
  if (!loaded) notFound();
  const { db, application } = loaded;
  const name = applicationName(application);
  const here = applicationHref(application.publicId);
  const { draft, latest } = applicationSummary(db, application);
  const readiness = applicationReadiness(db, application);
  const view = application.activeRevisionId ? applicationRevisionView(db, application.activeRevisionId) : null;
  const target = view?.target ?? null;
  const placements = placementStatesOf(db, application.id);
  const requests = new Map((view?.requests ?? []).map((row) => [row.placement.publicId, row]));
  const sameSeal = sameSealApplications(db, application.sealId, application.id);
  const candidates = placementCandidates(db, application);
  const actor = await rememberedActor();
  const dialog = param(query, "dialog");
  const retired = application.lifecycle === "retired";
  // A v1 revision's global environments are history; the environments the Application appears in are its placements'.
  const environments = view?.environments ?? [];
  const placementEnvironments = [...new Set((view?.requests ?? []).flatMap((row) => row.environments))].sort();

  const startDraft = (inline = false) => (
    <ActorDialog
      id="start-draft"
      action={startApplicationDraftAction.bind(null, application.publicId)}
      title={`Start a Draft of ${name}?`}
      description={latest ? `The Draft starts from revision ${latest.number}. That revision, and every review of it, stays as it is until the Draft is submitted.` : "The Draft holds the Application's details until you submit it."}
      confirmLabel="Start Draft"
      actor={actor}
      trigger={{ label: "Start a Draft", icon: "edit", variant: "primary" }}
      fallbackHref={`${here}?dialog=start-draft#dialog`}
      inline={inline}
      cancelHref={here}
    />
  );
  const retire = (inline = false) => (
    <ReasonDialog
      id="retire"
      action={retireApplicationAction.bind(null, application.publicId)}
      fields={{ lockVersion: String(application.lockVersion) }}
      title={`Retire ${name}?`}
      description="A retired Web Application can't change or be placed again. Its revisions, reviews, and history stay. Each Portal must retire its active placements first."
      confirmLabel="Retire Web Application"
      tone="danger"
      actor={actor}
      trigger={{ label: "Retire", icon: "trash" }}
      fallbackHref={`${here}?dialog=retire#dialog`}
      inline={inline}
      cancelHref={here}
    />
  );
  const reference = (inline = false) => (
    <ReferenceDialog
      id="reference"
      action={addApplicationReferenceAction.bind(null, application.publicId)}
      title={`Map ${name} to a Studio module group`}
      description="State the Studio module group that represents this Application, so reconciliation can compare it."
      confirmLabel="Save mapping"
      actor={actor}
      trigger={{ label: "Add mapping", icon: "link" }}
      fallbackHref={`${here}?dialog=reference#dialog`}
      inline={inline}
      cancelHref={`${here}#references`}
      resourceTypes={[{ value: "module_group", label: "Studio module group" }]}
      environments={placementEnvironments}
    />
  );
  const inlineDialog = dialog === "start-draft" && !draft && !retired ? startDraft(true) : dialog === "retire" && !retired ? retire(true) : dialog === "reference" && !retired ? reference(true) : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={applicationCrumbs}
        title={name}
        status={<Status state={application.lifecycle} />}
        meta={[application.ownerTeam ? `Owned by ${application.ownerTeam}` : "No owning team yet", application.sealId ? `SEAL ID ${application.sealId}` : "No SEAL ID"]}
        primaryAction={retired ? undefined : draft ? <ButtonLink href={applicationStepHref(application.publicId, "identity")} variant="primary" icon="edit">{`Continue revision ${draft.number}`}</ButtonLink> : startDraft()}
        extraActions={retired ? undefined : retire()}
        alerts={
          <>
            <OutcomeToast outcome={applicationOutcome(param(query, "notice"), application)} />
            {retired && <Alert title={`${name} is retired`}>No Portal serves it. Its revisions, reviews, and history stay below.</Alert>}
          </>
        }
      />
      {inlineDialog && <div id="dialog">{inlineDialog}</div>}

      <DescriptionList
        layout="columns"
        surface
        items={[
          ["Lifecycle", <Status key="lifecycle" state={application.lifecycle} />],
          [
            "Launch target",
            target ? (
              target.target.kind === "mfe" ? (
                <Link key="target" href={`/onboarding/microfrontends/${target.microfrontend!.publicId}`}>
                  {target.microfrontend!.name}
                </Link>
              ) : (
                <Tag key="target" label="endpoint">
                  {target.target.documentUrl ?? target.target.moduleUrl ?? target.target.manifestUrl ?? ""}
                </Tag>
              )
            ) : (
              "Not submitted yet"
            ),
          ],
          ["Rendering mode", target ? `${RENDERING_MODE_LABELS[target.target.renderingMode]}, ${CONFIRMED[target.target.confirmation]}` : "Not confirmed yet"],
          ["Submitted revision", latest ? <Link key="latest" href={`${here}/revisions/${latest.number}`}>{`Revision ${latest.number}`}</Link> : "None yet"],
          ["Draft", draft ? <Link key="draft" href={applicationStepHref(application.publicId, "identity")}>{`Revision ${draft.number}`}</Link> : "None"],
          ...(environments.length ? ([["Environments, earlier format", environments.map((environment) => environment.toUpperCase()).join(", ")]] as const) : []),
        ]}
      />

      <Section title="Readiness" description="Ready when the current revision's launch target is confirmed, every MFE it uses is confirmed by CDaaS, and at least one Portal has approved a placement.">
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
              <tr key={`${check.code}-${check.label}`}>
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

      <Section id="placements" title="Placements" description="Each Portal reviews its own placements. A decision in one Portal never changes another's.">
        <Panel flush>
          {placements.length > 0 ? (
            <Table
              label="Placements"
              head={
                <>
                  <Th>Portal</Th>
                  <Th>Requested</Th>
                  <Th>Latest request</Th>
                  <Th>Served</Th>
                </>
              }
            >
              {placements.map((placement) => {
                const request = requests.get(placement.placement);
                return (
                  <tr key={placement.placement}>
                    <Td label="Portal">
                      <Primary>
                        <Link href={`/onboarding/reviews/${placement.placement}`}>{`${name} · ${placement.portalName}`}</Link>
                      </Primary>
                      <Secondary>{`Revision ${placement.revision}`}</Secondary>
                    </Td>
                    <Td label="Requested">
                      {request ? <Tag label="route">{request.request.route}</Tag> : "—"}
                      {request && <Secondary>{[request.request.label, request.environments.map((environment) => environment.toUpperCase()).join(", ")].join(" · ")}</Secondary>}
                    </Td>
                    <Td label="Latest request">
                      <Status state={placement.latest} label={STATE_LABELS[placement.latest]} />
                    </Td>
                    <Td label="Served">{placement.effective === "approved" ? <Status state="active" label="Served" /> : "No"}</Td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState title="No placements requested">Request a route in each Portal that should serve the Application, in a Draft.</EmptyState>
          )}
        </Panel>
      </Section>

      {candidates.length > 0 && (
        <Section title="Claimed in ownership" description="Portals ownership claims put this Application in, with no placement requested yet. A claim is a candidate only: it's never approved by itself.">
          <Panel flush>
            <Table
              label="Placement candidates"
              head={
                <>
                  <Th>Portal</Th>
                  <Th>Claim</Th>
                </>
              }
            >
              {candidates.map((candidate) => (
                <tr key={candidate.portal.publicId}>
                  <Td label="Portal">
                    <Link href={`/onboarding/portals/${candidate.portal.publicId}`}>{candidate.portal.label}</Link>
                    <Secondary>{candidate.portal.onboarded ? "Can take placements" : "Not onboarded yet"}</Secondary>
                  </Td>
                  <Td label="Claim">{claimText(candidate)}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </Section>
      )}

      {view && target && (
        <Section title="Composition" description={`What revision ${latest?.number} launches, and the children its launch target loads at runtime. Onboarding records and checks it; it renders nothing.`}>
          <CodeBlock label="Composition outline" code={compositionOutline(db, application.activeRevisionId!)} />
          {view.components.length > 0 && (
            <Panel flush>
              <Table
                label="MFEs it uses"
                head={
                  <>
                    <Th>MFE</Th>
                    <Th>Role</Th>
                    <Th>Mount</Th>
                  </>
                }
              >
                {view.components.map(({ component, microfrontend }) => (
                  <tr key={microfrontend.publicId}>
                    <Td label="MFE">
                      <Link href={`/onboarding/microfrontends/${microfrontend.publicId}`}>{microfrontend.name}</Link>
                    </Td>
                    <Td label="Role">{component.role === "entry" ? "Entry: the launch target" : component.required ? "Required child" : "Optional child"}</Td>
                    <Td label="Mount">{component.mountKind ? `${component.mountKind === "route" ? "Route" : "Slot"} ${component.mountKey}` : "—"}</Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}
        </Section>
      )}

      <div id="current-state">
        <CurrentState items={applicationState(db, application)} refresh={retired ? undefined : refreshApplicationAction.bind(null, application.publicId)} />
      </div>

      {sameSeal.length > 0 && (
        <Section title={`Other Applications with SEAL ID ${application.sealId}`} description="Separate records: each has its own owner, composition, placements, and history.">
          <Panel flush>
            <Table
              label="Applications sharing the SEAL ID"
              head={
                <>
                  <Th>Application</Th>
                  <Th>Lifecycle</Th>
                </>
              }
            >
              {sameSeal.map((other) => (
                <tr key={other.publicId}>
                  <Td label="Application">
                    <Primary>
                      <Link href={applicationHref(other.publicId)}>{applicationName(other)}</Link>
                    </Primary>
                    <Secondary>{other.ownerTeam ? `Owned by ${other.ownerTeam}` : "No owning team yet"}</Secondary>
                  </Td>
                  <Td label="Lifecycle">
                    <Status state={other.lifecycle} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </Section>
      )}

      <Section title="Revisions" description="Each submitted revision is frozen, with its placement requests; edits start a new Draft.">
        <RevisionsTable revisions={revisionsOf(db, "application", application.id)} href={(number) => `${here}/revisions/${number}`} active={application.activeRevisionId} draftHref={applicationStepHref(application.publicId, "identity")} />
      </Section>

      <Section id="references" title="Mappings" description="The Studio module group this Application is mapped to, which reconciliation compares." actions={!retired && reference()}>
        <ReferencesTable references={referencesOf(db, { kind: "application", id: application.id })} remove={(item) => (item.source === "person" && !retired ? removeApplicationReferenceAction.bind(null, application.publicId, item.publicId) : null)} />
      </Section>

      <Section title="History" description="Each change, with who made it as they stated it.">
        <LifecycleHistory events={applicationHistory(db, application.id)} />
      </Section>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["ID", <Tag key="id" copy label="ID">{application.publicId}</Tag>],
            ["Created", <RelativeTime key="created" value={application.createdAt} />],
            ...(draft ? ([["Draft version", draft.lockVersion]] as const) : []),
          ]}
        />
      </Disclosure>
    </Page>
  );
}
