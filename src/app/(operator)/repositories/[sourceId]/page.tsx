import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { findSource } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { currentVersion, versionCount, versionsOf } from "@/lib/profiling/versions";
import { RepositoryView } from "./repository-view";

const loadSource = cache((publicId: string) => findSource(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ sourceId: string }> }): Promise<Metadata> {
  return { title: loadSource((await params).sourceId)?.name ?? "Repository not found" };
}

/** A Repository's page: its current profile version, the newest that wrote a Profile (docs/profiling.md). */
export default async function RepositoryPage({ params, searchParams }: { params: Promise<{ sourceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const source = loadSource(sourceId);
  if (!source) notFound();
  const db = getDb();
  return <RepositoryView source={source} shown={currentVersion(db, source.id)} latest={versionsOf(db, source.id, 1)[0]} count={versionCount(db, source.id)} explicit={false} query={query} />;
}
