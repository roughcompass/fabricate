import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupRelationships, GroupTable, SharedList } from "@/components/relationships/map-lists";
import { href, lineOfBusinessLevel } from "@/lib/relationships/levels";
import { loadRun, mapTitle } from "../../load";
import { MapLevel, NoMap } from "../../map-level";

type Params = Promise<{ assessmentId: string; lineOfBusiness: string }>;

const idOf = (segment: string) => (segment === "none" ? null : segment);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { assessmentId, lineOfBusiness } = await params;
  const run = loadRun(assessmentId);
  return { title: mapTitle(run, run?.view ? run.view.labels.lineOfBusiness(idOf(lineOfBusiness)) : undefined) };
}

/** One Line of Business: its portals, its applications in no portal, and the portals of other Lines of Business it appears in. */
export default async function LineOfBusinessPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId, lineOfBusiness }, query] = await Promise.all([params, searchParams]);
  const run = loadRun(assessmentId);
  if (!run) notFound();
  const { view } = run;
  if (!view) return <NoMap run={run} />;
  const level = lineOfBusinessLevel(run.db, view, idOf(lineOfBusiness));
  if (!level) notFound();

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title={level.label}
      ancestors={[]}
      description={`The portals of ${level.label}, its applications in no portal, and the portals of other Lines of Business where its applications appear.`}
      levelHref={href.lineOfBusiness(view, level.id)}
      scope={{ kind: "from", nodes: level.members }}
      scopeDescription={`Relationships declared by ${level.label}'s repositories.`}
    >
      <GroupTable title="Portals" label="Portal" groups={level.portals} empty="No portals" />
      {level.applications.length > 0 && <GroupTable title="Applications in no portal" label="SEAL application" groups={level.applications} empty="No applications" />}
      {level.otherPortals.length > 0 && <GroupTable title="Portals of other Lines of Business" description={`Portals owned by another Line of Business that ${level.label}'s applications appear in.`} label="Portal" groups={level.otherPortals} empty="No portals" />}
      <GroupRelationships relationships={level.relationships} description="Relationships between repositories in different groups here, rolled up." />
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
