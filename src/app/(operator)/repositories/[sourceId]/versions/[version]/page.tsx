import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { findSource } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findVersion, versionCount, versionsOf } from "@/lib/profiling/versions";
import { RepositoryView } from "../../repository-view";

const load = cache((publicId: string, number: string) => {
  const source = findSource(getDb(), publicId);
  const version = source && /^[1-9][0-9]{0,8}$/.test(number) ? findVersion(getDb(), source.id, Number(number)) : undefined;
  return source && version ? { source, version } : undefined;
});

export async function generateMetadata({ params }: { params: Promise<{ sourceId: string; version: string }> }): Promise<Metadata> {
  const { sourceId, version } = await params;
  const found = load(sourceId, version);
  return { title: found ? `Version ${found.version.version} · ${found.source.name}` : "Version not found" };
}

/** One profile version of a Repository, whatever its state (docs/profiling.md). */
export default async function VersionPage({ params, searchParams }: { params: Promise<{ sourceId: string; version: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ sourceId, version }, query] = await Promise.all([params, searchParams]);
  const found = load(sourceId, version);
  if (!found) notFound();
  const db = getDb();
  return <RepositoryView source={found.source} shown={found.version} latest={versionsOf(db, found.source.id, 1)[0]} count={versionCount(db, found.source.id)} explicit query={query} />;
}
