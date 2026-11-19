import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { repositoryProfiling } from "@/lib/profiling/versions";
import { RepositoryView } from "./repository-view";
import { loadRepository } from "./load";

export async function generateMetadata({ params }: PageProps<"/repositories/[repositoryId]">): Promise<Metadata> {
  return { title: loadRepository((await params).repositoryId)?.name ?? "Repository not found" };
}

/** A Repository's page: its current Profile, the newest any Run wrote (docs/profiling.md). */
export default async function RepositoryPage({ params, searchParams }: PageProps<"/repositories/[repositoryId]">) {
  const [{ repositoryId }, query] = await Promise.all([params, searchParams]);
  const repository = loadRepository(repositoryId);
  if (!repository) notFound();
  return <RepositoryView repository={repository} {...repositoryProfiling(getDb(), repository.id)} query={query} />;
}
