import crypto from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnershipValues } from "@/components/ownership/ownership-values";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { assessmentNumber } from "@/lib/assessments/assessment-records";
import { assessmentState, claimView, hostClaims } from "@/lib/ownership/claims";
import { deConsoleApplications, deConsoleStatus } from "@/lib/ownership/de-console";
import { chooseSealId, submitClaim } from "../actions";
import { QuestionsForm, SealForm } from "../claim-forms";
import { claimOutcome } from "../outcomes";
import { DeConsoleAlert, choicesFor, claimCrumbs, loadClaim, rememberedClaimant } from "./load";

type Params = Promise<{ sourceId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadClaim((await params).sourceId);
  return { title: loaded ? `Claim ${loaded.source.name}` : "Repository not found" };
}

/**
 * A claim of one Repository: its SEAL ID first, then only the values still
 * unknown. A Repository whose ownership is known shows it and offers
 * corrections instead of questions.
 */
export default async function ClaimRepositoryPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const loaded = loadClaim(sourceId);
  if (!loaded) notFound();
  const { db, source } = loaded;
  const view = claimView(db, source, param(query, "seal"));
  const status = deConsoleStatus(db);
  const consoleReadAt = status.lastSuccess?.readAt ?? null;
  const here = `/repositories/claim/${source.publicId}`;
  const header = (description: string, secondaryActions = [] as { href: string; label: string; icon: "edit" }[]) => (
    <PageHeader
      breadcrumbs={claimCrumbs}
      title={source.name}
      meta={[source.cloneUrl]}
      description={description}
      secondaryActions={secondaryActions}
      alerts={
        <>
          <OutcomeToast outcome={claimOutcome(param(query, "notice"), source)} />
          <DeConsoleAlert status={status} />
        </>
      }
    />
  );

  if (view.asks.sealId) {
    const listed = deConsoleApplications(db).map((application) => ({ value: application.sealId, label: application.name ? `${application.sealId} · ${application.name}` : application.sealId }));
    return (
      <Page width="form">
        {header("Which SEAL application does this Repository belong to?")}
        <SealForm action={chooseSealId.bind(null, source.publicId)} listed={listed} cancelHref="/repositories/claim" />
      </Page>
    );
  }

  const values = (
    <OwnershipValues
      link={view.linked ? view.ownership.application : null}
      chosenSealId={view.linked ? null : view.sealId}
      application={view.application}
      hosts={hostClaims(db, source.id)}
      consoleReadAt={consoleReadAt}
      surface
    />
  );

  if (!view.known) {
    const choices = choicesFor(db);
    return (
      <Page width="form">
        {header(view.linked ? "Some of this Repository's ownership isn't known yet." : `Claim this Repository for ${view.sealId}.`)}
        <Section title="Known so far" description={view.deWeb ? "This application is listed in the DE Console, which is the record of its team and portals." : undefined}>
          {values}
        </Section>
        <QuestionsForm
          action={submitClaim.bind(null, source.publicId)}
          sealId={view.sealId!}
          asks={view.asks}
          portals={choices.portals}
          linesOfBusiness={choices.linesOfBusiness}
          claimant={await rememberedClaimant()}
          launchToken={crypto.randomUUID()}
          cancelHref="/repositories/claim"
        />
      </Page>
    );
  }

  const runs = assessmentState(db, source.id);
  return (
    <Page width="form">
      {header("This Repository's ownership is known. Correct it if anything is wrong.", [{ href: `${here}/correct`, label: "Correct ownership", icon: "edit" }])}
      <Section title="Ownership" description="Current ownership, with where each value came from.">
        {values}
      </Section>
      <Section title="Profile">
        <Panel>
          {runs.profile ? (
            <p>
              <Link href={`/profiles/${runs.profile.publicId}`}>Open the Profile of {source.name}</Link> from Run #{assessmentNumber(db, runs.profile.assessment)}, finished <RelativeTime value={runs.profile.assessment.finishedAt} />.
            </p>
          ) : runs.active ? (
            <p>
              <Link href={`/runs/${runs.active.publicId}`}>Run #{assessmentNumber(db, runs.active)}</Link> is assessing {source.name}: <Status state={runs.active.state} size="sm" />
            </p>
          ) : (
            <p>{source.name} has no Profile yet. Its last Run didn&apos;t finish.</p>
          )}
        </Panel>
      </Section>
    </Page>
  );
}
