import type { Metadata } from "next";
import { CreateRecordForm } from "@/components/onboarding/create-form";
import { Page, PageHeader } from "@/components/ui/page";
import { rememberedActor } from "../../actor";
import { createPortalAction } from "../actions";
import { portalCrumbs } from "../load";

export const metadata: Metadata = { title: "New Portal" };

export default async function NewPortalPage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={portalCrumbs} title="New Portal" description="A Portal is configuration its team owns: the environments it enables, its menu, and the placements it reviews. It owns no code. Its name is fixed once it's created." />
      <CreateRecordForm
        action={createPortalAction}
        noun="Portal"
        actor={await rememberedActor()}
        cancelHref="/onboarding/portals"
        nameDescription="Such as Access or Markets. A Portal named in an ownership claim keeps its identity when you onboard it."
        sealDescription="Metadata only: other Portals, Applications, and MFEs may carry the same SEAL ID."
      />
    </Page>
  );
}
