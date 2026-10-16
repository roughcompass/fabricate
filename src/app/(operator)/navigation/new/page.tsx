import type { Metadata } from "next";
import { CreatePortalForm } from "@/components/onboarding/create-portal";
import { Page, PageHeader } from "@/components/ui/page";
import { whatsIncluded } from "@/lib/onboarding/whats-included";
import { createPortalAction } from "../actions";
import { navigationCrumbs } from "../paths";

export const metadata: Metadata = { title: "New Portal" };

/**
 * The Create Portal dialog's form as a page (portal-creation spec), with What's
 * included beside it: the address the dialog's openers lead to before
 * JavaScript runs, and one that works without it.
 */
export default function NewPortalPage() {
  return (
    <Page>
      <PageHeader breadcrumbs={navigationCrumbs} title="New Portal" />
      <CreatePortalForm action={createPortalAction} included={whatsIncluded()} mode="page" />
    </Page>
  );
}
