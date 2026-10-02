import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Diagram } from "@/components/relationships/diagram";
import { SharedList } from "@/components/relationships/map-lists";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { applicationLevel, href } from "@/lib/relationships/levels";
import { loadRun, mapTitle } from "../../load";
import { MapLevel, NoMap } from "../../map-level";
import styles from "../../map.module.css";

type Params = Promise<{ assessmentId: string; sealId: string }>;

const sealOf = (segment: string) => decodeURIComponent(segment);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { assessmentId, sealId } = await params;
  const run = loadRun(assessmentId);
  const application = run?.view ? [...run.view.applications.values()].find((item) => item.sealId === sealOf(sealId)) : undefined;
  return { title: mapTitle(run, application ? run!.view!.labels.application(application.id) : undefined) };
}

/** One SEAL application: its repositories, what depends on them, and what they depend on. */
export default async function ApplicationPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId, sealId }, query] = await Promise.all([params, searchParams]);
  const run = loadRun(assessmentId);
  if (!run) notFound();
  const { view } = run;
  if (!view) return <NoMap run={run} />;
  const level = applicationLevel(run.db, view, sealOf(sealId));
  if (!level) notFound();

  return (
    <MapLevel
      run={run}
      view={view}
      query={query}
      title={level.label}
      ancestors={[level.lineOfBusiness]}
      description="The application's repositories in the middle row, the repositories that depend on them above, and what they depend on below: libraries built in this Run, then services."
      levelHref={href.application(view, level.sealId)}
      scope={{ kind: "from", nodes: level.members }}
      scopeDescription={`Relationships declared by ${level.label}'s repositories.`}
    >
      {level.portals.length > 0 && (
        <Section title="Portals" description="The portals this application is claimed in.">
          <ul className={styles.portals}>
            {level.portals.map((portal) => (
              <li key={portal.key}>
                <Link href={portal.href}>{portal.label}</Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Diagram" description="Every relationship between two of these repositories is drawn. Third-party packages and each repository's own package are left out.">
        <Panel>
          <Diagram id="application-diagram" label={`${level.label} application`} data={level.diagram} />
        </Panel>
      </Section>
      <SharedList entries={level.shared} />
    </MapLevel>
  );
}
