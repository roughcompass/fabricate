import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { repositoryProfiling } from "@/lib/profiling/versions";
import { RepositoryView } from "./repository-view";
import { loadRepository } from "./load";

export async function generateMetadata({ params }: PageProps<"/repositories/[sourceId]">): Promise<Metadata> {
  return { title: loadRepository((await params).sourceId)?.name ?? "Repository not found" };
}

/** A Repository's page: its current Profile, the newest any Run wrote (docs/profiling.md). */
export default async function RepositoryPage({ params, searchParams }: PageProps<"/repositories/[sourceId]">) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const source = loadRepository(sourceId);
  if (!source) notFound();
  return <RepositoryView source={source} {...repositoryProfiling(getDb(), source.id)} query={query} />;
}
