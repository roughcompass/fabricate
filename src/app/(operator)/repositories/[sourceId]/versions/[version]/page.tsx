import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { versionsOf } from "@/lib/profiling/versions";
import { RepositoryView } from "../../repository-view";
import { loadVersion } from "../../load";

export async function generateMetadata({ params }: PageProps<"/repositories/[sourceId]/versions/[version]">): Promise<Metadata> {
  const { sourceId, version } = await params;
  const found = loadVersion(sourceId, version);
  return { title: found ? `Version ${found.version.version} · ${found.source.name}` : "Version not found" };
}

/** One version of a Repository, a survey, whatever its state (docs/profiling.md). */
export default async function VersionPage({ params, searchParams }: PageProps<"/repositories/[sourceId]/versions/[version]">) {
  const [{ sourceId, version }, query] = await Promise.all([params, searchParams]);
  const found = loadVersion(sourceId, version);
  if (!found) notFound();
  const latest = versionsOf(getDb(), found.source.id, 1)[0];
  return <RepositoryView source={found.source} version={found.version} latest={latest} count={latest?.version ?? 0} query={query} />;
}
