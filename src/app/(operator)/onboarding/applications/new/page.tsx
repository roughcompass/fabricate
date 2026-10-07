import type { Metadata } from "next";
import { CreateRecordForm } from "@/components/onboarding/create-form";
import { Page, PageHeader } from "@/components/ui/page";
import { rememberedActor } from "../../actor";
import { createApplicationAction } from "../actions";
import { applicationCrumbs } from "../load";

export const metadata: Metadata = { title: "New Web Application" };

export default async function NewApplicationPage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={applicationCrumbs} title="New Web Application" description="A Web Application is one route-level experience. It keeps its own identity even when other Applications share its SEAL ID." />
      <CreateRecordForm
        action={createApplicationAction}
        noun="Web Application"
        actor={await rememberedActor()}
        cancelHref="/onboarding/applications"
        nameDescription="Such as Payments workspace."
        sealDescription="Metadata only: other Applications may carry the same SEAL ID and stay separate."
      />
    </Page>
  );
}
