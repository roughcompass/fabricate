import { asc, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Attributed } from "@/components/onboarding/attribution";
import { DifferencesTable } from "@/components/onboarding/differences";
import { ValidationIssues } from "@/components/onboarding/issues";
import { RuntimeContractSummary } from "@/components/onboarding/runtime-contract";
import { CodeBlock } from "@/components/ui/code-block";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag, TagList } from "@/components/ui/tag";
import { placementDecisions } from "@/lib/db/schema";
import { applicationName, applicationRevisionView, compositionOutline, requestState } from "@/lib/onboarding/applications";
import { compareDocuments } from "@/lib/onboarding/contracts";
import { CAPABILITY_LABELS, type Capability, RENDERING_MODE_LABELS, runtimeContractSchema } from "@/lib/onboarding/documents";
import { latestValidation, revisionByNumber } from "@/lib/onboarding/revisions";
import { applicationCrumbs, applicationHref, loadApplication } from "../../../load";

type Params = Promise<{ applicationId: string; revision: string }>;

function load(applicationId: string, revision: string) {
  const loaded = loadApplication(applicationId);
  const number = /^\d{1,6}$/.test(revision) ? Number(revision) : NaN;
  const found = loaded && Number.isInteger(number) ? revisionByNumber(loaded.db, "application", loaded.application.id, number) : undefined;
  return loaded && found?.state === "submitted" ? { ...loaded, revision: found } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { applicationId, revision } = await params;
  const loaded = load(applicationId, revision);
  return { title: loaded ? `Revision ${loaded.revision.number} · ${applicationName(loaded.application)} · Web Applications` : "Revision not found" };
}

const SOURCE_LABELS = { mfe_contract: "Submitted MFE rendering metadata or contract", studio: "Studio module type", cdaas: "CDaaS" } as const;
const CONFIRMED = { inferred: "Confirmed from the evidence", override: "Overridden: chosen over the evidence", explicit: "Chosen explicitly: no evidence proposed a mode" } as const;
const STATE_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", retired: "Retired" } as const;

/**
 * One submitted, frozen Application revision: its launch target and how its
 * rendering mode was settled, its composition, and the placement it asked of
 * each Portal with that request's review state.
 */
export default async function ApplicationRevisionPage({ params }: { params: Params }) {
  const { applicationId, revision: number } = await params;
  const loaded = load(applicationId, number);
  if (!loaded) notFound();
  const { db, application, revision } = loaded;
  const name = applicationName(application);
  const view = applicationRevisionView(db, revision.id);
  const target = view.target;
  const document = revision.document as { requiredCapabilities?: string[] };
  const previous = revision.number > 1 ? revisionByNumber(db, "application", application.id, revision.number - 1) : undefined;
  const before = previous?.state === "submitted" ? previous : undefined;
  const validation = latestValidation(db, "application", revision.id);
  const current = revision.id === application.activeRevisionId;
  const requestIds = view.requests.map((row) => row.request.id);
  const decisions = requestIds.length ? db.select().from(placementDecisions).where(inArray(placementDecisions.placementRequestId, requestIds)).orderBy(asc(placementDecisions.sequence)).all() : [];
  const latestDecision = new Map(decisions.map((decision) => [decision.placementRequestId, decision]));
  const hostContract = target?.target.hostContract ? runtimeContractSchema.safeParse(JSON.parse(target.target.hostContract)) : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[...applicationCrumbs, { href: applicationHref(application.publicId), label: name }]}
        title={`Revision ${revision.number}`}
        status={<Status state={current ? "active" : "submitted"} label={current ? "Current" : "Submitted"} />}
        meta={[<span key="by">{`Submitted by ${revision.submittedBy}, unverified`}</span>, <RelativeTime key="at" value={revision.submittedAt} />]}
        description="A submitted revision is frozen: its launch target, composition, and placement requests stay as they were reviewed. Edits start a new Draft."
      />
      <DescriptionList
        layout="columns"
        surface
        items={[
          ["Owning team", (revision.document.ownerTeam as string | null) ?? "None"],
          ["SEAL ID", (revision.document.sealId as string | null) ?? "None"],
          ...(revision.formatVersion === 1
            ? ([
                ["Environments, earlier format", view.environments.map((environment) => environment.toUpperCase()).join(", ") || "None"],
                ["Required Portal capabilities, earlier format", (document.requiredCapabilities ?? []).map((capability) => CAPABILITY_LABELS[capability as Capability]).join(", ") || "None"],
              ] as const)
            : ([["Environment catalog", view.catalog ? `${view.catalog.source === "studio" ? "Studio" : "Fallback"}, digest ${view.catalog.digest.slice(0, 12)}` : "Not recorded"]] as const)),
        ]}
      />
      {target && (
        <Section title="Launch target" description="What the Portal launches and how it renders it, with the evidence that proposed the mode and how the team settled it.">
          <DescriptionList
            surface
            items={[
              ["Target", target.target.kind === "mfe" ? <Link key="mfe" href={`/onboarding/microfrontends/${target.microfrontend!.publicId}`}>{`${target.microfrontend!.name} (registered MFE)`}</Link> : "External endpoint"],
              ["Rendering mode", RENDERING_MODE_LABELS[target.target.renderingMode]],
              ...([
                ["Document URL", target.target.documentUrl],
                ["Module URL", target.target.moduleUrl],
                ["Exported module", target.target.exportedModule],
                ["Manifest URL", target.target.manifestUrl],
                ["Exposed module", target.target.exposedModule],
              ] as const)
                .filter(([, value]) => value)
                .map(([term, value]) => [term, <Tag key={term} label={term}>{value!}</Tag>] as const),
              ...(target.target.configuration !== "{}" ? ([["Settings", <code key="settings">{target.target.configuration}</code>]] as const) : []),
              ["Confirmation", <span key="confirmation">{`${CONFIRMED[target.target.confirmation]}, by `}<Attributed name={target.target.confirmedBy} attribution="unverified" /></span>],
            ]}
          />
          {view.candidates.length > 0 && (
            <Panel flush>
              <Table
                label="Rendering evidence"
                head={
                  <>
                    <Th>Proposed</Th>
                    <Th>Proposed by</Th>
                    <Th>Observed</Th>
                  </>
                }
              >
                {view.candidates.map((candidate) => {
                  const configuration = JSON.parse(candidate.configuration) as { module?: string | null; location?: string | null };
                  return (
                    <tr key={candidate.id}>
                      <Td label="Proposed">
                        {RENDERING_MODE_LABELS[candidate.renderingMode]}
                        <Secondary>{[configuration.module, candidate.chosen ? "Confirmed" : target.target.confirmation === "override" ? "Overridden" : null].filter(Boolean).join(" · ") || "—"}</Secondary>
                      </Td>
                      <Td label="Proposed by">
                        {SOURCE_LABELS[candidate.source]}
                        <Secondary>{candidate.evidenceReference}</Secondary>
                      </Td>
                      <Td label="Observed">
                        <RelativeTime value={candidate.observedAt} />
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Panel>
          )}
        </Section>
      )}
      {target && (
        <Section title="Composition" description="The children the launch target loads at runtime.">
          <CodeBlock label="Composition outline" code={compositionOutline(db, revision.id)} />
          {hostContract?.success && (
            <>
              <h3>External host contract, earlier format</h3>
              <RuntimeContractSummary contract={hostContract.data} />
            </>
          )}
        </Section>
      )}
      <Section title="Placement requests" description="What this revision asked of each Portal, and each request's review. The Portal's owner may accept different values.">
        <Panel flush>
          <Table
            label="Placement requests"
            head={
              <>
                <Th>Portal</Th>
                <Th>Route</Th>
                <Th>Environments</Th>
                <Th>Review</Th>
              </>
            }
          >
            {view.requests.map(({ request, placement, portal, environments }) => {
              const state = requestState(latestDecision.get(request.id)?.decision ?? null);
              return (
                <tr key={request.id}>
                  <Td label="Portal">
                    <Primary>
                      <Link href={`/onboarding/reviews/${placement.publicId}`}>{`${name} · ${portal.label}`}</Link>
                    </Primary>
                    <Secondary>{[request.label, request.menuParentKey ? `under ${request.menuParentKey}` : "top level", `position ${request.ordering}`].join(" · ")}</Secondary>
                  </Td>
                  <Td label="Route">
                    <Tag label="route">{request.route}</Tag>
                    {request.defaultRequested && <Secondary>Asks to be the default</Secondary>}
                  </Td>
                  <Td label="Environments">
                    <TagList values={environments.map((environment) => environment.toUpperCase())} />
                  </Td>
                  <Td label="Review">
                    <Status state={state} label={STATE_LABELS[state]} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      </Section>
      <Section title={before ? `Changes from revision ${before.number}` : "Changes"} description={before ? "Each field added, removed, or changed since the revision before." : "The first revision; there's nothing to compare it with."}>
        <DifferencesTable label={`Changes from revision ${before?.number ?? revision.number}`} differences={before ? compareDocuments(before.document, revision.document) : []} empty={before ? "This revision is the same as the one before." : "This is the Application's first revision."} />
      </Section>
      {validation && validation.issues.length > 0 && (
        <Section title="Validation at submission" description="Warnings recorded when the revision was submitted; nothing blocked it.">
          <ValidationIssues issues={validation.issues} stepOf={() => ({ href: applicationHref(application.publicId), label: name })} />
        </Section>
      )}
      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["Digest", <Tag key="digest" copy label="digest">{revision.digest!}</Tag>],
            ["Submitted by", <Attributed key="by" name={revision.submittedBy!} attribution="unverified" />],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
