import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { versionsOf } from "@/lib/profiling/versions";
import { RepositoryView } from "../../repository-view";
import { loadVersion } from "../../load";

export async function generateMetadata({ params }: PageProps<"/repositories/[repositoryId]/versions/[version]">): Promise<Metadata> {
  const { repositoryId, version } = await params;
  const found = loadVersion(repositoryId, version);
  return { title: found ? `Version ${found.version.version} · ${found.repository.name}` : "Version not found" };
}

/** One version of a Repository, a survey, whatever its state (docs/profiling.md). */
export default async function VersionPage({ params, searchParams }: PageProps<"/repositories/[repositoryId]/versions/[version]">) {
  const [{ repositoryId, version }, query] = await Promise.all([params, searchParams]);
  const found = loadVersion(repositoryId, version);
  if (!found) notFound();
  const latest = versionsOf(getDb(), found.repository.id, 1)[0];
  return <RepositoryView repository={found.repository} version={found.version} latest={latest} count={latest?.version ?? 0} query={query} />;
}
