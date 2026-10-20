import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { findPortal, isOnboarded } from "@/lib/onboarding/portals";
import { PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import { editPortalAction } from "../../actions";
import { portalsCrumbs, portalHref } from "../../paths";
import { PortalEditForm } from "./edit-form";

function onboardedPortal(portalId: string) {
  if (!isPublicId(portalId, "ptl")) return null;
  const db = getDb();
  const portal = findPortal(db, portalId);
  return portal && isOnboarded(db, portal.id) ? portal : null;
}

export async function generateMetadata({ params }: { params: Promise<{ portalId: string }> }): Promise<Metadata> {
  const portal = onboardedPortal((await params).portalId);
  return { title: portal ? `Edit details · ${portal.label}` : "Portal not found" };
}

/** A Portal's Edit details form, opened from its Navigation page (navigation spec). */
export default async function EditPortalPage({ params }: { params: Promise<{ portalId: string }> }) {
  const portal = onboardedPortal((await params).portalId);
  if (!portal) notFound();
  const back = portalHref(portal.publicId);
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[...portalsCrumbs, { href: back, label: portal.label }]} title="Edit details" />
      <PortalEditForm
        action={editPortalAction.bind(null, portal.publicId)}
        initial={{ values: { sealId: portal.sealId ?? "", name: portal.label, ownerTeam: portal.ownerTeam ?? "", description: portal.description ?? "" }, errors: {} }}
        lockVersion={portal.lockVersion}
        cancelHref={back}
        fixed={{ platform: portal.platform ? PORTAL_PLATFORM_LABELS[portal.platform] : null, slug: portal.slug }}
      />
    </Page>
  );
}
