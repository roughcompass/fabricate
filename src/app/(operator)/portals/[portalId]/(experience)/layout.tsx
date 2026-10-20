import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeviceProvider } from "@/components/experience/device";
import { ExperienceFrame, RuntimeHeader } from "@/components/experience/editor-frame";
import { ExperienceEditorProvider } from "@/components/experience/store";
import { Page } from "@/components/ui/page";
import { getDb } from "@/lib/db/client";
import { demoEnabled } from "@/lib/demo/guard";
import { catalogs } from "@/lib/experience/catalogs";
import { defaultExperience } from "@/lib/experience/document";
import { currentExperience, experienceVersions } from "@/lib/experience/versions";
import { portalApplications } from "@/lib/onboarding/navigation";
import { onboardedPortal } from "../../load";
import { saveExperienceAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ portalId: string }> }): Promise<Metadata> {
  const portal = onboardedPortal((await params).portalId);
  return { title: portal ? `${portal.label} · Runtime Configuration` : "Portal not found" };
}

/**
 * A Portal's Runtime Configuration pages (runtime-configuration spec): the
 * Experience Editor and the configuration sections, inside the shell. The
 * layout loads the Portal's current experience, its Applications, its saved
 * versions, and the catalogs, and holds one working experience across every
 * page beneath it, so pending changes, Undo, and Redo span them all and one
 * Save makes one version (design decision 3). The header carries the
 * actions. It needs JavaScript; without it, it says so.
 */
export default async function ExperienceEditorLayout({ params, children }: { params: Promise<{ portalId: string }>; children: React.ReactNode }) {
  const portal = onboardedPortal((await params).portalId);
  if (!portal) notFound();
  const db = getDb();
  const loaded = catalogs();
  const { experience, number } = currentExperience(db, portal, loaded);
  const versions = experienceVersions(db, portal.id).map((version) => ({
    number: version.number,
    changeCount: version.changeCount,
    changes: JSON.parse(version.changes) as string[],
    actor: version.actor,
    attribution: version.attribution,
    createdAt: version.createdAt.toISOString(),
  }));
  return (
    <Page width="full">
      <ExperienceEditorProvider
        key={`${portal.publicId}:${number}`}
        data={{
          portal: { publicId: portal.publicId, label: portal.label, lifecycle: portal.lifecycle },
          saved: experience,
          defaults: defaultExperience(portal, [], loaded.toolkits, loaded.themes),
          baseNumber: number,
          lockVersion: portal.lockVersion,
          catalogs: loaded,
          applications: portalApplications(db, portal.id).map((application) => ({ publicId: application.publicId, name: application.name ?? application.publicId, slug: application.slug })),
          versions,
          demoEnabled: demoEnabled(),
          save: saveExperienceAction,
        }}
      >
        <DeviceProvider>
          <RuntimeHeader />
          <ExperienceFrame>{children}</ExperienceFrame>
        </DeviceProvider>
      </ExperienceEditorProvider>
    </Page>
  );
}
