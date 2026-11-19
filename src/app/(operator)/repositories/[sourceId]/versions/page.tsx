import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { pageNumber, param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { TRIGGER_LABELS, versionCount, versionsOf } from "@/lib/profiling/versions";
import { ReprofileForm, VersionStatus } from "../repository-view";
import { routes } from "@/lib/web/routes";
import { loadRepository } from "../load";

const PAGE_SIZE = 25;

export async function generateMetadata({ params }: PageProps<"/repositories/[sourceId]/versions">): Promise<Metadata> {
  const source = loadRepository((await params).sourceId);
  return { title: source ? `Versions · ${source.name}` : "Repository not found" };
}

/** Every version of a Repository, its surveys, newest first: why it was queued, its state, and what it profiled (docs/profiling.md). */
export default async function VersionsPage({ params, searchParams }: PageProps<"/repositories/[sourceId]/versions">) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const source = loadRepository(sourceId);
  if (!source) notFound();
  const db = getDb();
  const total = versionCount(db, source.id);
  const { page, pages } = pageNumber(param(query, "page"), total, PAGE_SIZE);
  const versions = versionsOf(db, source.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/repositories", label: "Repositories" },
          { href: routes.repository(source.publicId), label: source.name },
        ]}
        title="Versions"
        description={`${countLabel(total, "version")} of ${source.name}, one survey each of a commit with a Surveyor release and configuration. A version runs when the repository is added, edited, or re-profiled, when its reference has a new commit, when Surveyor is upgraded, and when a Run or a preview needs a commit no version has surveyed.`}
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
                <Th>Surveyor</Th>
                <Th>Queued</Th>
              </>
            }
          >
            {versions.map((version) => (
              <tr key={version.version}>
                <Td label="Version">
                  <Primary>
                    <Link href={routes.repositoryVersion(source.publicId, version.version)}>{`Version ${version.version}`}</Link>
                  </Primary>
                  <Secondary>{version.requestedBy ? <Link href={routes.run(version.requestedBy.assessmentPublicId)}>{`Run of ${version.requestedBy.name}`}</Link> : TRIGGER_LABELS[version.trigger]}</Secondary>
                </Td>
                <Td label="Status">
                  <VersionStatus version={version} size="sm" />
                  {version.failure && <Secondary>{version.failure.message}</Secondary>}
                </Td>
                <Td label="Commit">
                  <ShortValue value={version.commit} label="commit" />
                  <Secondary mono>{version.survey.reference}</Secondary>
                </Td>
                <Td label="Surveyor">
                  <Tag>{version.survey.surveyorRelease}</Tag>
                  <Secondary>{`Profile version ${version.survey.profileSchemaVersion}`}</Secondary>
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
      <Pagination label="Version pages" page={page} pages={pages} href={(number) => routes.repositoryVersions(source.publicId, number)} />
    </Page>
  );
}
