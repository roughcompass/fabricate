import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Diagram } from "@/components/relationships/diagram";
import { GroupTable, MembershipLists, SharedList } from "@/components/relationships/map-lists";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { href, portalLevel } from "@/lib/relationships/levels";
import { loadRun, mapTitle } from "../../load";
import { MapLevel, NoMap } from "../../map-level";

type Params = Promise<{ assessmentId: string; portal: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { assessmentId, portal } = await params;
  const run = loadRun(assessmentId);
  return { title: mapTitle(run, run?.view?.portals.get(portal)?.label) };
}

/** One portal: its diagram, its applications, and its claims beside what its host loads. */
export default async function PortalPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId, portal }, query] = await Promise.all([params, searchParams]);
  const run = loadRun(assessmentId);
  if (!run) notFound();
  const { view } = run;
  if (!view) return <NoMap run={run} />;
  const level = portalLevel(run.db, view, portal);
  if (!level) notFound();
  const owner = level.ownerLabel ? `Owned by ${level.ownerLabel}.` : "No owner is claimed.";
  const host = level.hostName ? ` Hosted by ${level.hostName}.` : " No host is claimed.";

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title={level.label}
      ancestors={[level.lineOfBusiness]}
      description={`${owner}${host} The diagram places the host above the applications it loads, then the libraries built in this Run that they use, then the applications claimed here that the host doesn't load.`}
      levelHref={href.portal(view, level.id)}
      scope={{ kind: "from", nodes: level.members }}
      scopeDescription={`Relationships declared by the repositories in ${level.label}.`}
    >
      <Section title="Diagram" description="Only relationships between applications are drawn. Third-party packages and each repository's own package are left out.">
        <Panel>
          <Diagram id="portal-diagram" label={`${level.label} portal`} data={level.diagram} />
        </Panel>
      </Section>
      <GroupTable title="Applications" description="The applications in this portal, with the relationships between their own repositories." label="Application" groups={level.groups} empty="No applications are claimed in this portal" />
      <MembershipLists membership={level.membership} hostName={level.hostName} />
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
