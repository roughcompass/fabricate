import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateRecordForm } from "@/components/onboarding/create-form";
import { Page, PageHeader } from "@/components/ui/page";
import { applicationName } from "@/lib/onboarding/applications";
import { rememberedActor } from "../../../../actor";
import { registerMicrofrontendAction } from "../../../../microfrontends/actions";
import { applicationCrumbs, applicationHref, applicationStepHref, loadApplication } from "../../../load";

type Params = Promise<{ applicationId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadApplication((await params).applicationId);
  return { title: loaded ? `Register MFE · ${applicationName(loaded.application)} · Web Applications` : "Web Application not found" };
}

/**
 * Registers an MFE the Application's composition needs: a shared asset any
 * Application can then reuse. After its Draft is submitted, the flow returns
 * to the same composition.
 */
export default async function RegisterMicrofrontendPage({ params }: { params: Params }) {
  const loaded = loadApplication((await params).applicationId);
  if (!loaded) notFound();
  const { application } = loaded;
  const composition = applicationStepHref(application.publicId, "composition");
  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[...applicationCrumbs, { href: applicationHref(application.publicId), label: applicationName(application) }, { href: composition, label: "Composition" }]}
        title="Register MFE"
        description="An MFE is a shared asset: this one becomes available to every Web Application, and you come back to this composition when it's submitted."
      />
      <CreateRecordForm
        action={registerMicrofrontendAction.bind(null, application.publicId)}
        noun="MFE"
        actor={await rememberedActor()}
        cancelHref={composition}
        nameDescription="Such as Payee search."
        sealDescription="Metadata only: other MFEs, Applications, and Portals may carry the same SEAL ID."
        ownerTeamDescription={application.ownerTeam ? `Leave it empty to make ${application.ownerTeam}, which owns this Application, its owner.` : undefined}
      />
    </Page>
  );
}
