import { and, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Attributed } from "@/components/onboarding/attribution";
import { CurrentState } from "@/components/onboarding/current-state";
import { ReferenceDialog } from "@/components/onboarding/dialogs";
import { ReferencesTable } from "@/components/onboarding/references";
import { Alert } from "@/components/ui/alert";
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
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag, TagList } from "@/components/ui/tag";
import { applicationPlacements, applications, placementRoutes } from "@/lib/db/schema";
import { applicationName, applicationRevisionView, compositionOutline, placementChecks } from "@/lib/onboarding/applications";
import { RENDERING_MODE_LABELS } from "@/lib/onboarding/documents";
import { placementState } from "@/lib/onboarding/external/current-state";
import { referencesOf } from "@/lib/onboarding/external/references";
import { currentDefault } from "@/lib/onboarding/placements";
import { governingRevision, portalRevisionView } from "@/lib/onboarding/portals";
import { type Decision, reviewTitle } from "@/lib/onboarding/reviews";
import { revisionByNumber } from "@/lib/onboarding/revisions";
import { rememberedActor } from "../../actor";
import { addPlacementReferenceAction, decidePlacementAction, refreshPlacementAction, removePlacementReferenceAction } from "../actions";
import { ApproveDialog, DecisionDialog, type Replacement } from "../decision-dialogs";
import { loadReview, reviewCrumbs, reviewHref } from "../load";
import { reviewOutcome } from "../outcomes";

type Params = Promise<{ placementId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadReview((await params).placementId);
  return { title: loaded ? `${reviewTitle(loaded.review)} · Reviews` : "Placement review not found" };
}

const STATE_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", retired: "Retired" } as const;
const DECISION_LABELS = { approve: "Approved", reject: "Rejected", withdraw: "Withdrawn", retire: "Retired" } as const;
const CONFIRMED = { inferred: "confirmed from the evidence", override: "chosen over the evidence", explicit: "chosen explicitly; no evidence proposed a mode" } as const;
const SOURCE_LABELS = { mfe_contract: "the submitted MFE rendering metadata", studio: "the Studio module type", cdaas: "CDaaS" } as const;

const entitlementsText = (json: string | null) => {
  const value = JSON.parse(json ?? '{"codes":[],"operator":"any"}') as { codes: string[]; operator: string };
  return value.codes.length ? `${value.codes.join(", ")}${value.codes.length > 1 ? (value.operator === "all" ? " (all of them)" : " (any one)") : ""}` : "No restriction";
};

/**
 * One placement's review: what the Application asks of the Portal, what it
 * launches and how that was settled, the checks a decision rests on, what
 * Studio reports, and every decision. Each decision is recorded here,
 * unverified, and changes nothing outside onboarding.
 */
export default async function PlacementReviewPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ placementId }, query] = await Promise.all([params, searchParams]);
  const loaded = loadReview(placementId);
  if (!loaded) notFound();
  const { db, review } = loaded;
  const { placement, portal, application, request } = review;
  const here = reviewHref(placement.publicId);
  const name = applicationName(application);
  const title = reviewTitle(review);
  const actor = await rememberedActor();
  const dialog = param(query, "dialog");
  const revisionRow = revisionByNumber(db, "application", application.id, review.revision)!;
  const view = applicationRevisionView(db, revisionRow.id);
  const governing = governingRevision(db, portal);
  const menu = governing ? portalRevisionView(db, portal, governing).menu : [];
  const checks = placementChecks(db, { portal, placementId: placement.id, route: request.route, environments: review.environments });
  const applicationHref = `/onboarding/applications/${application.publicId}`;
  const portalHref = `/onboarding/portals/${portal.publicId}`;
  const latest = review.decisions.at(-1)?.decision ?? null;
  // The approval that's served now: this request's, or an earlier one still active under it.
  const approval: Decision | null = review.activeRequest?.decision ?? (latest?.decision === "approve" ? latest : null);

  // Environments this placement is the default of, and who could take each over.
  const defaults = review.environments.filter((environment) => currentDefault(db, portal.id, environment).placementId === placement.id);
  const replacements: Replacement[] = defaults.map((environment) => ({
    environment,
    options: db
      .select({ placement: applicationPlacements.publicId, name: applications.name, sealId: applications.sealId, route: placementRoutes.route })
      .from(placementRoutes)
      .innerJoin(applicationPlacements, eq(applicationPlacements.id, placementRoutes.placementId))
      .innerJoin(applications, eq(applications.id, placementRoutes.applicationId))
      .where(and(eq(placementRoutes.portalId, portal.id), eq(placementRoutes.environment, environment), eq(placementRoutes.active, true), ne(placementRoutes.placementId, placement.id)))
      .all()
      .map((row) => ({ value: row.placement, label: `${applicationName(row)} at ${row.route}` })),
  }));

  const canApprove = review.state === "pending" && portal.lifecycle !== "retired";
  const canReject = review.state === "pending";
  // An approval still served under a newer request is withdrawn or retired through the request it approved.
  const servedRevision = review.activeRequest?.revision ?? (review.state === "approved" ? review.revision : null);
  const servedSequence = review.activeRequest ? review.activeRequest.decision.sequence + 1 : review.sequence;
  const canWithdraw = review.state === "pending" || review.state === "approved";
  const canRetire = servedRevision !== null;
  const common = { actor, cancelHref: here };
  const approve = (inline = false, unavailable = false) => (
    <ApproveDialog
      {...common}
      id="approve"
      action={decidePlacementAction.bind(null, placement.publicId, review.revision, "approve")}
      expectedSequence={review.sequence}
      title={`Approve ${title}?`}
      description={`Records the approval of revision ${review.revision}'s request with the values below, labeled Unverified. ${portal.label} serves it in onboarding's record; nothing changes in Studio, CDaaS, or ServiceNow.`}
      confirmLabel="Approve"
      trigger={{ label: "Approve", icon: "check", variant: "primary" }}
      fallbackHref={`${here}?dialog=approve#dialog`}
      inline={inline}
      unavailable={unavailable}
      requested={{ route: request.route, menuParent: request.menuParentKey ?? "", label: request.label, order: String(request.ordering), codes: (JSON.parse(request.entitlements) as { codes: string[] }).codes.join("\n"), operator: (JSON.parse(request.entitlements) as { operator: string }).operator, defaults: request.defaultRequested ? review.environments.filter((environment) => !currentDefault(db, portal.id, environment).placementId) : [] }}
      menu={menu.map((group) => ({ value: group.key, label: group.label }))}
      environments={review.environments}
    />
  );
  const reject = (inline = false, unavailable = false) => (
    <DecisionDialog
      {...common}
      id="reject"
      action={decidePlacementAction.bind(null, placement.publicId, review.revision, "reject")}
      expectedSequence={review.sequence}
      reasonRequired
      title={`Reject ${title}?`}
      description={`Records the rejection of revision ${review.revision}'s request, with the reason, labeled Unverified. ${name}'s placements in other Portals don't change.`}
      confirmLabel="Reject"
      unavailable={unavailable}
      tone="danger"
      trigger={{ label: "Reject", icon: "x" }}
      fallbackHref={`${here}?dialog=reject#dialog`}
      inline={inline}
    />
  );
  const withdraw = (inline = false, unavailable = false) => (
    <DecisionDialog
      {...common}
      id="withdraw"
      action={decidePlacementAction.bind(null, placement.publicId, review.revision, "withdraw")}
      expectedSequence={review.sequence}
      reasonRequired={false}
      replacements={review.state === "approved" ? replacements : []}
      title={`Withdraw ${title}?`}
      description={review.state === "approved" ? `${name} stops being served in ${portal.label}. Its request and decisions stay in the history.` : review.activeRequest ? `Revision ${review.revision}'s request is withdrawn before ${portal.label} decides it. Revision ${review.activeRequest.revision}'s approval stays served.` : `The request is withdrawn before ${portal.label} decides it. Its history stays.`}
      confirmLabel="Withdraw"
      unavailable={unavailable}
      tone="danger"
      trigger={{ label: "Withdraw", icon: "undo" }}
      fallbackHref={`${here}?dialog=withdraw#dialog`}
      inline={inline}
    />
  );
  const retire = (inline = false, unavailable = false) => (
    <DecisionDialog
      {...common}
      id="retire"
      action={decidePlacementAction.bind(null, placement.publicId, servedRevision ?? review.revision, "retire")}
      expectedSequence={servedSequence}
      reasonRequired
      replacements={replacements}
      title={`Retire ${title}?`}
      description={`${portal.label} stops serving ${name} at ${approval?.acceptedRoute ?? request.route}. The placement and its history stay.`}
      confirmLabel="Retire placement"
      unavailable={unavailable}
      tone="danger"
      trigger={{ label: "Retire", icon: "trash" }}
      fallbackHref={`${here}?dialog=retire#dialog`}
      inline={inline}
    />
  );
  const reference = (inline = false) => (
    <ReferenceDialog
      id="reference"
      action={addPlacementReferenceAction.bind(null, placement.publicId)}
      title={`Map ${title} to a Studio menu`}
      description="State the Studio menu that represents this placement in one environment, so reconciliation can compare its label, entitlements, and channel."
      confirmLabel="Save mapping"
      actor={actor}
      trigger={{ label: "Add mapping", icon: "link" }}
      fallbackHref={`${here}?dialog=reference#dialog`}
      inline={inline}
      cancelHref={`${here}#references`}
      resourceTypes={[{ value: "menu", label: "Studio menu" }]}
      environments={review.environments}
    />
  );
  const inlineDialog =
    dialog === "approve" && canApprove ? approve(true) : dialog === "reject" && canReject ? reject(true) : dialog === "withdraw" && canWithdraw ? withdraw(true) : dialog === "retire" && canRetire ? retire(true) : dialog === "reference" ? reference(true) : null;
  // Each decision's dialog stays mounted, its trigger hidden when it doesn't apply, so a decision refused
  // because someone else decided first keeps its dialog, what was entered, and the message about the change.
  const extraActions = (
    <>
      {reject(false, !canReject)}
      {withdraw(false, !canWithdraw)}
      {retire(false, !canRetire)}
    </>
  );

  const rows: [string, string, string][] = [
    ["Route", request.route, approval?.acceptedRoute ?? "—"],
    ["Menu group", request.menuParentKey ?? "Top level", approval ? (approval.acceptedMenuParentKey ?? "Top level") : "—"],
    ["Menu label", request.label, approval?.acceptedLabel ?? "—"],
    ["Position", String(request.ordering), approval?.acceptedOrdering === null || approval?.acceptedOrdering === undefined ? "—" : String(approval.acceptedOrdering)],
    ["Entitlements", entitlementsText(request.entitlements), approval ? entitlementsText(approval.acceptedEntitlements) : "—"],
    ["Default route", request.defaultRequested ? "Asked for" : "Not asked for", approval ? ((JSON.parse(approval.acceptedDefaults ?? "[]") as string[]).map((environment) => environment.toUpperCase()).join(", ") || "None") : "—"],
  ];
  const target = view.target;

  return (
    <Page>
      <PageHeader
        breadcrumbs={reviewCrumbs}
        title={title}
        status={<Status state={review.state} label={STATE_LABELS[review.state]} />}
        meta={[`Revision ${review.revision} of ${name}`, <span key="by">{`Submitted by ${review.submittedBy ?? "someone"}, unverified`}</span>, <RelativeTime key="at" value={review.submittedAt} />]}
        primaryAction={approve(false, !canApprove)}
        extraActions={extraActions}
        alerts={
          <>
            <OutcomeToast outcome={reviewOutcome(param(query, "notice"), review)} />
            {review.activeRequest && (
              <Alert title={`Revision ${review.activeRequest.revision}'s approval is still served`}>
                {`${portal.label} serves ${name} at ${review.activeRequest.decision.acceptedRoute} while revision ${review.revision}'s request is reviewed. Approving it replaces that route; rejecting it leaves it.`}
              </Alert>
            )}
            {portal.lifecycle === "retired" && <Alert title={`${portal.label} is retired`}>It can&apos;t approve placements.</Alert>}
          </>
        }
      />
      {inlineDialog && <div id="dialog">{inlineDialog}</div>}

      <DescriptionList
        layout="columns"
        surface
        items={[
          ["Application", <Link key="application" href={applicationHref}>{name}</Link>],
          ["Application revision", <Link key="revision" href={`${applicationHref}/revisions/${review.revision}`}>{`Revision ${review.revision}`}</Link>],
          ["Portal", <Link key="portal" href={portalHref}>{portal.label}</Link>],
          ["Portal revision", governing ? <Link key="governing" href={`${portalHref}/revisions/${governing.number}`}>{`Revision ${governing.number}${portal.activeRevisionId === governing.id ? ", active" : ""}`}</Link> : "None submitted"],
          ["Environments", <TagList key="environments" values={review.environments.map((environment) => environment.toUpperCase())} />],
          ["Served", review.effective === "approved" ? <Status key="served" state="active" label="Served" /> : "No"],
        ]}
      />

      <Section title="Requested and accepted" description="What the Application team asked for, and what the Portal's owner accepted in the approval served now. The Portal decides; the request never activates a route.">
        <Panel flush>
          <Table
            label="Requested and accepted values"
            head={
              <>
                <Th>Value</Th>
                <Th>Requested</Th>
                <Th>Accepted</Th>
              </>
            }
          >
            {rows.map(([label, requested, accepted]) => (
              <tr key={label}>
                <Td label="Value">{label}</Td>
                <Td label="Requested">{requested}</Td>
                <Td label="Accepted">{accepted}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>

      <Section title="Checks" description={checks.compared.length ? `Run now against ${checks.compared.join("; ")}.` : "Nothing to compare yet."}>
        <Panel flush>
          {checks.issues.length > 0 ? (
            <Table
              label="Check results"
              head={
                <>
                  <Th>Check</Th>
                  <Th>Result</Th>
                </>
              }
            >
              {checks.issues.map((issue) => (
                <tr key={`${issue.code}-${issue.location}-${issue.message}`}>
                  <Td label="Check">{issue.message}</Td>
                  <Td label="Result">
                    <Status state={issue.severity === "blocking" ? "blocking" : "warning"} label={issue.severity === "blocking" ? "Blocking" : "Warning"} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="Every check passes" icon="checkCircle">
              The Portal still enables every requested environment, and no other placement serves the route in any of them.
            </EmptyState>
          )}
        </Panel>
      </Section>

      {target && (
        <Section title="Launch target" description={`What revision ${review.revision} launches, how its rendering mode was settled, and the evidence that proposed it.`}>
          <DescriptionList
            surface
            items={[
              ["Target", target.target.kind === "mfe" ? <Link key="mfe" href={`/onboarding/microfrontends/${target.microfrontend!.publicId}`}>{`${target.microfrontend!.name} (registered MFE)`}</Link> : <Tag key="endpoint" label="endpoint">{target.target.documentUrl ?? target.target.moduleUrl ?? target.target.manifestUrl ?? ""}</Tag>],
              ["Rendering mode", `${RENDERING_MODE_LABELS[target.target.renderingMode]}${target.target.exportedModule ? `, exports ${target.target.exportedModule}` : target.target.exposedModule ? `, exposes ${target.target.exposedModule}` : ""}`],
              ["Confirmation", <span key="confirmation">{`${CONFIRMED[target.target.confirmation][0]!.toUpperCase()}${CONFIRMED[target.target.confirmation].slice(1)}, by `}<Attributed name={target.target.confirmedBy} attribution="unverified" /></span>],
              ["Inference", view.candidates.length ? view.candidates.map((candidate) => `${RENDERING_MODE_LABELS[candidate.renderingMode]} from ${SOURCE_LABELS[candidate.source]} (${candidate.evidenceReference})${candidate.chosen ? ", confirmed" : ""}`).join("; ") : "Nothing proposed a mode"],
            ]}
          />
          <CodeBlock label="Composition outline" code={compositionOutline(db, revisionRow.id)} />
        </Section>
      )}

      <div id="current-state">
        <CurrentState items={placementState(db, placement.id)} refresh={refreshPlacementAction.bind(null, placement.publicId)} description="What Studio last reported for this placement's menus, compared with the approval served now. Nothing here changes Studio." />
      </div>

      <Section id="decisions" title="Decisions" description="Every decision about this placement, oldest first, each naming the revisions it decided. Names are as stated and unverified.">
        <Panel flush>
          {review.history.length > 0 ? (
            <Table
              label="Decisions"
              head={
                <>
                  <Th>Decision</Th>
                  <Th>Revisions</Th>
                  <Th>By</Th>
                  <Th>When</Th>
                </>
              }
            >
              {review.history.map(({ decision, applicationRevision, portalRevision }) => (
                <tr key={decision.publicId}>
                  <Td label="Decision">
                    <Status state={DECISION_LABELS[decision.decision].toLowerCase()} label={DECISION_LABELS[decision.decision]} />
                    {decision.reason && <Secondary>{decision.reason}</Secondary>}
                    {decision.acceptedRoute && <Secondary>{`At ${decision.acceptedRoute}`}</Secondary>}
                  </Td>
                  <Td label="Revisions">
                    <Link href={`${applicationHref}/revisions/${applicationRevision}`}>{`${name} revision ${applicationRevision}`}</Link>
                    <Secondary>{`Against ${portal.label} revision ${portalRevision}`}</Secondary>
                  </Td>
                  <Td label="By">
                    <Attributed name={decision.actor} attribution={decision.attribution} />
                  </Td>
                  <Td label="When">
                    <RelativeTime value={decision.decidedAt} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="Not decided yet">{`${portal.label}'s owner approves or rejects it here.`}</EmptyState>
          )}
        </Panel>
      </Section>

      <Section id="references" title="Mappings" description="The Studio menu that represents this placement in each environment." actions={reference()}>
        <ReferencesTable references={referencesOf(db, { kind: "placement", id: placement.id })} remove={(item) => (item.source === "person" ? removePlacementReferenceAction.bind(null, placement.publicId, item.publicId) : null)} />
      </Section>

      <Alert title="Provisioning stays outside onboarding">Decisions here create no Studio module, menu, or entitlement, upload nothing to CDaaS, and open no ServiceNow change. Those remain manual, by the teams that own them.</Alert>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["Placement ID", <Tag key="placement" copy label="placement ID">{placement.publicId}</Tag>],
            ["Application ID", <Tag key="application" copy label="Application ID">{application.publicId}</Tag>],
            ["Portal ID", <Tag key="portal" copy label="Portal ID">{portal.publicId}</Tag>],
            ["Decisions so far", review.sequence],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
