import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupRelationships, GroupTable, SharedList } from "@/components/relationships/map-lists";
import { href, unassignedLevel } from "@/lib/relationships/levels";
import { loadRun, mapTitle } from "../load";
import { MapLevel, NoMap } from "../map-level";

export async function generateMetadata({ params }: { params: Promise<{ assessmentId: string }> }): Promise<Metadata> {
  return { title: mapTitle(loadRun((await params).assessmentId), "Unassigned") };
}

/** Repositories nobody has claimed, grouped into the runtime systems their composition, iframe, and runtime-contract relationships form. */
export default async function UnassignedPage({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const run = loadRun(assessmentId);
  if (!run) notFound();
  const { view } = run;
  if (!view) return <NoMap run={run} />;
  const level = unassignedLevel(run.db, view);

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title="Unassigned"
      ancestors={[]}
      description="Repositories with no claim, grouped into runtime systems: the repositories that compose, embed, or exchange runtime contracts with one another. A system is named for its host."
      levelHref={href.unassigned(view)}
      scope={{ kind: "from", nodes: level.members }}
      scopeDescription="Relationships declared by unassigned repositories."
    >
      <GroupTable title="Runtime systems" label="Runtime system" groups={level.systems} empty="Every repository in this Run is claimed" />
      <GroupRelationships relationships={level.relationships} description="Relationships between repositories in different runtime systems, rolled up." />
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
