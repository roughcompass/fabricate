import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EditorFrame } from "@/components/experience/editor-frame";
import { ExperienceEditorProvider } from "@/components/experience/store";
import { ShellHeader } from "@/components/shell/shell-header";
import { Page } from "@/components/ui/page";
import { getDb } from "@/lib/db/client";
import { demoEnabled } from "@/lib/demo/guard";
import { catalogs } from "@/lib/experience/catalogs";
import { defaultExperience } from "@/lib/experience/document";
import { currentExperience, experienceVersions } from "@/lib/experience/versions";
import { portalApplications } from "@/lib/onboarding/navigation";
import { onboardedPortal } from "../../load";
import { navigationHref } from "../../paths";
import { saveExperienceAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ portalId: string }> }): Promise<Metadata> {
  const portal = onboardedPortal((await params).portalId);
  return { title: portal ? `${portal.label} · Experience editor` : "Portal not found" };
}

/**
 * A Portal's experience editor (experience-editor spec): a focused page that
 * loads the Portal's current experience, its Applications, its saved
 * versions, and the catalogs, and holds the editor's client state across
 * its views. It needs JavaScript; without it, it says so.
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
      <ShellHeader back={{ href: navigationHref(portal.publicId), label: `Back to ${portal.label}` }} title={portal.label} />
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
        <EditorFrame>{children}</EditorFrame>
      </ExperienceEditorProvider>
    </Page>
  );
}
