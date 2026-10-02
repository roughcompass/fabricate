import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Diagram } from "@/components/relationships/diagram";
import { SharedList } from "@/components/relationships/map-lists";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { href, systemLevel } from "@/lib/relationships/levels";
import { loadRun, mapTitle } from "../../load";
import { MapLevel, NoMap } from "../../map-level";

type Params = Promise<{ assessmentId: string; system: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { assessmentId, system } = await params;
  const run = loadRun(assessmentId);
  return { title: mapTitle(run, run?.view?.placements.systems.find((item) => item.id === system)?.name) };
}

/** One runtime system of unassigned repositories. */
export default async function SystemPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId, system }, query] = await Promise.all([params, searchParams]);
  const run = loadRun(assessmentId);
  if (!run) notFound();
  const { view } = run;
  if (!view) return <NoMap run={run} />;
  const level = systemLevel(run.db, view, system);
  if (!level) notFound();

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title={level.label}
      ancestors={[{ label: "Unassigned", href: href.unassigned(view) }]}
      description="A runtime system of unclaimed repositories: its repositories in the middle row, what depends on them above, and what they depend on below."
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
