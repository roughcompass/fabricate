import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { claimView } from "@/lib/ownership/claims";
import { submitCorrection } from "../../actions";
import { CorrectionForm } from "../../claim-forms";
import { DeConsoleAlert, choicesFor, claimCrumbs, loadClaim, rememberedClaimant } from "../load";

type Params = Promise<{ sourceId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadClaim((await params).sourceId);
  return { title: loaded ? `Correct ownership of ${loaded.source.name}` : "Repository not found" };
}

/** Corrections to a claimed Repository's ownership. Each saved change supersedes the claims it replaces. */
export default async function CorrectOwnershipPage({ params }: { params: Params }) {
  const { sourceId } = await params;
  const loaded = loadClaim(sourceId);
  if (!loaded) notFound();
  const { db, source } = loaded;
  const here = `/repositories/claim/${source.publicId}`;
  const view = claimView(db, source);
  if (!view.linked || !view.application) redirect(here);
  const { application } = view;
  const consoleTeam = application.team.provenance?.source === "de_console" ? application.team.value : null;
  const lineOfBusiness = application.lineOfBusiness.value;
  const choices = choicesFor(db, { portals: application.portals.map((item) => item.portal), lineOfBusiness });
  const listedLine = lineOfBusiness && choices.linesOfBusiness.some((line) => line.value === lineOfBusiness.label);

  return (
    <Page width="form">
      <PageHeader breadcrumbs={[...claimCrumbs, { href: here, label: source.name }]} title="Correct ownership" description="Change what's wrong. The earlier values stay in the history." alerts={<DeConsoleAlert />} />
      <CorrectionForm
        action={submitCorrection.bind(null, source.publicId)}
        initial={{
          values: {
            sealId: view.sealId ?? "",
            team: consoleTeam === null ? (application.team.value ?? "") : "",
            lineOfBusiness: listedLine ? lineOfBusiness.label : "",
            lineOfBusinessOther: lineOfBusiness && !listedLine ? lineOfBusiness.label : "",
            portals: application.portals.map((item) => item.portal.label),
            providedBy: await rememberedClaimant(),
          },
          errors: {},
        }}
        consoleTeam={consoleTeam}
        consolePortals={view.deWeb}
        portals={choices.portals}
        linesOfBusiness={choices.linesOfBusiness}
        cancelHref={here}
      />
    </Page>
  );
}
