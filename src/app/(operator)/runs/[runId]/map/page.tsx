import type { Metadata } from "next";
import { GroupRelationships, GroupTable, SharedList } from "@/components/relationships/map-lists";
import { StatGroup } from "@/components/ui/stat-group";
import { href, runLevel } from "@/lib/relationships/levels";
import { loadMap, loadMapLevel, mapTitle } from "./load";
import { MapLevel, NoMap } from "./map-level";

export async function generateMetadata({ params }: PageProps<"/runs/[runId]/map">): Promise<Metadata> {
  return { title: mapTitle(loadMap((await params).runId)) };
}

/** The Run level: each runtime system, and each repository on its own, with the relationships between them. */
export default async function MapPage({ params, searchParams }: PageProps<"/runs/[runId]/map">) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const found = loadMapLevel(runId, (run, view) => runLevel(run.db, view));
  if (!found.view) return <NoMap run={found.run} />;
  const { run, view, level } = found;

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title="Relationship Map"
      description="This Run's repositories by runtime system, with the relationships between them. Open a system to see its diagram, or focus a repository to see what a change to it affects."
      levelHref={href.run(view)}
      scope={{ kind: "from", nodes: new Set(view.repositories.keys()) }}
      scopeDescription="Every relationship in this Run, from the repository that declared each one."
    >
      <StatGroup
        label="This Run"
        stats={[
          { label: "Repositories", value: level.total },
          { label: "Runtime systems", value: level.groups.filter((group) => group.repositories > 1).length },
          { label: "On their own", value: level.groups.filter((group) => group.repositories === 1).length },
        ]}
      />
      <GroupTable title="Runtime systems" description="Repositories tied together by composition, iframe, or a runtime contract, and each repository on its own." label="Runtime system" groups={level.groups} empty="No repositories" />
      <GroupRelationships relationships={level.relationships} description="Relationships between repositories in different groups, rolled up. Relationships inside a group are counted with it." />
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
