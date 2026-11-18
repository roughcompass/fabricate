import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { findSource } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { TRIGGER_LABELS, versionCount, versionsOf } from "@/lib/profiling/versions";
import { repositoryHref, versionHref, versionsHref } from "@/lib/web/repository-paths";
import { ReprofileForm, VersionStatus } from "../repository-view";

const PAGE_SIZE = 25;

const loadSource = cache((publicId: string) => findSource(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ sourceId: string }> }): Promise<Metadata> {
  const source = loadSource((await params).sourceId);
  return { title: source ? `Versions · ${source.name}` : "Repository not found" };
}

/** Every profile version of a Repository, newest first: why it was queued, its state, and what it profiled (docs/profiling.md). */
export default async function VersionsPage({ params, searchParams }: { params: Promise<{ sourceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const source = loadSource(sourceId);
  if (!source) notFound();
  const db = getDb();
  const total = versionCount(db, source.id);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.parseInt(param(query, "page") ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const versions = versionsOf(db, source.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/repositories", label: "Repositories" },
          { href: repositoryHref(source.publicId), label: source.name },
        ]}
        title="Versions"
        description={`${countLabel(total, "profile version")} of ${source.name}. A version is queued when the repository is added, edited, or re-profiled, when its reference has new commits, and when the detector changes.`}
        primaryAction={<ReprofileForm source={source} />}
      />
      <Panel flush>
        {versions.length > 0 ? (
          <Table
            label={`Versions of ${source.name}`}
            head={
              <>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Commit</Th>
                <Th>Detector release</Th>
                <Th>Queued</Th>
              </>
            }
          >
            {versions.map((version) => (
              <tr key={version.version}>
                <Td label="Version">
                  <Primary>
                    <Link href={versionHref(source.publicId, version.version)}>{`Version ${version.version}`}</Link>
                  </Primary>
                  <Secondary>{TRIGGER_LABELS[version.trigger]}</Secondary>
                </Td>
                <Td label="Status">
                  <VersionStatus version={version} size="sm" />
                  {version.failure && <Secondary>{version.failure.message}</Secondary>}
                </Td>
                <Td label="Commit">{version.commit ? <ShortValue value={version.commit} label="commit" /> : <Secondary>Not acquired</Secondary>}</Td>
                <Td label="Detector release">
                  <Tag>{version.assessment.detectorRelease}</Tag>
                </Td>
                <Td label="Queued">
                  <RelativeTime value={version.createdAt} />
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No versions yet" icon="clock">
            Its first version is profiled in the background.
          </EmptyState>
        )}
      </Panel>
      <Pagination label="Version pages" page={page} pages={pages} href={(number) => versionsHref(source.publicId, number)} />
    </Page>
  );
}
