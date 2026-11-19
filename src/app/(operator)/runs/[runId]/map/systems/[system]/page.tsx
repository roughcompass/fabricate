import type { Metadata } from "next";
import { Diagram } from "@/components/relationships/diagram";
import { SharedList } from "@/components/relationships/map-lists";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { href, systemLevel } from "@/lib/relationships/levels";
import { loadMap, loadMapLevel, mapTitle } from "../../load";
import { MapLevel, NoMap } from "../../map-level";

export async function generateMetadata({ params }: PageProps<"/runs/[runId]/map/systems/[system]">): Promise<Metadata> {
  const { runId, system } = await params;
  const run = loadMap(runId);
  return { title: mapTitle(run, run?.view?.systems.get(system)?.name) };
}

/** One runtime system: repositories tied together by composition, iframe, or a runtime contract, or one repository on its own. */
export default async function SystemPage({ params, searchParams }: PageProps<"/runs/[runId]/map/systems/[system]">) {
  const [{ runId, system }, query] = await Promise.all([params, searchParams]);
  const found = loadMapLevel(runId, (run, view) => systemLevel(run.db, view, system));
  if (!found.view) return <NoMap run={found.run} />;
  const { run, view, level } = found;

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title={level.label}
      description="Its hosts above the repositories they load, what depends on it from outside at the top, and what it depends on below."
      levelHref={href.system(view, level.id)}
      scope={{ kind: "from", nodes: level.members }}
      scopeDescription={`Relationships declared by the repositories of ${level.label}.`}
    >
      <Section title="Diagram" description="Every relationship between two of these repositories is drawn. Third-party packages and each repository's own package are left out.">
        <Panel>
          <Diagram id="system-diagram" label={`${level.label} runtime system`} data={level.diagram} />
        </Panel>
      </Section>
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
