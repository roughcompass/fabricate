import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { portals } from "@/lib/db/schema";
import { isPublicId } from "@/lib/db/ids";
import { portalOwnership, repositoryOwnership } from "@/lib/ownership/read";
import { applicationLabel } from "@/lib/ownership/records";
import { confirmOwner } from "../../actions";
import { OwnerForm } from "../../claim-forms";
import { claimCrumbs, loadClaim, rememberedClaimant } from "../load";

export const metadata: Metadata = { title: "Confirm the portal's owner" };

/** Proposes the Repository's application as owner of the unowned portal it hosts, for the claimant to confirm. */
export default async function ConfirmOwnerPage({ params, searchParams }: { params: Promise<{ sourceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const loaded = loadClaim(sourceId);
  const portalId = param(query, "portal") ?? "";
  if (!loaded || !isPublicId(portalId, "ptl")) notFound();
  const { db, source } = loaded;
  const here = `/repositories/claim/${source.publicId}`;
  const portal = db.select().from(portals).where(eq(portals.publicId, portalId)).get();
  if (!portal) notFound();
  const application = repositoryOwnership(db, [source.id]).get(source.id)!.application.value;
  // Owned since, or never hosted here: nothing to confirm.
  const ownership = portalOwnership(db, [portal.id]).get(portal.id)!;
  if (!application || ownership.owner.value || !ownership.host.candidates.some((candidate) => candidate.value.id === source.id)) redirect(here);

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[...claimCrumbs, { href: here, label: source.name }]}
        title="Confirm the portal's owner"
        description={`${portal.label} has no owning application. Confirm that ${applicationLabel(application)}, which ${source.name} belongs to, owns it.`}
      />
      <OwnerForm action={confirmOwner.bind(null, source.publicId, portal.publicId)} claimant={await rememberedClaimant()} cancelHref={here} />
    </Page>
  );
}
