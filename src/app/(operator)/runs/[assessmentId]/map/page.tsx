import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupRelationships, GroupTable, SharedList } from "@/components/relationships/map-lists";
import { StatGroup } from "@/components/ui/stat-group";
import { href, runLevel } from "@/lib/relationships/levels";
import { loadRun, mapTitle } from "./load";
import { MapLevel, NoMap } from "./map-level";

export async function generateMetadata({ params }: { params: Promise<{ assessmentId: string }> }): Promise<Metadata> {
  return { title: mapTitle(loadRun((await params).assessmentId)) };
}

/** The Run level: each Line of Business, and Unassigned, with the relationships between them. */
export default async function MapPage({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const run = loadRun(assessmentId);
  if (!run) notFound();
  const { view } = run;
  if (!view) return <NoMap run={run} />;
  const level = runLevel(run.db, view);

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title="Relationship Map"
      ancestors={[]}
      description="This Run's repositories by Line of Business, then portal and application, with the relationships between them. Open a group to go down a level, or focus a repository to see what a change to it affects."
      levelHref={href.run(view)}
      scope={{ kind: "from", nodes: new Set(view.repositories.keys()) }}
      scopeDescription="Every relationship in this Run, from the repository that declared each one."
    >
      <StatGroup
        label="This Run"
        stats={[
          { label: "Repositories", value: level.total },
          { label: "Lines of Business", value: level.groups.filter((group) => group.key.startsWith("lob:")).length },
          { label: "Portals", value: view.portals.size },
          { label: "Unassigned", value: level.groups.find((group) => group.key === "unassigned")?.repositories ?? 0, href: href.unassigned(view) },
        ]}
      />
      <GroupTable title="Lines of Business" description="Each Line of Business with its repositories, including those that appear in its portals from other Lines of Business." label="Line of Business" groups={level.groups} empty="No repositories" />
      <GroupRelationships relationships={level.relationships} description="Relationships between repositories in different groups, rolled up. Relationships inside a group are counted with it." />
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
