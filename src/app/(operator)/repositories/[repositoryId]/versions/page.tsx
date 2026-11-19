import type { Metadata } from "next";
import { IndexTemplate } from "@/components/templates/index-template";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { pageNumber, param } from "@/lib/web/query";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { TRIGGER_LABELS, versionCount, versionsOf } from "@/lib/profiling/versions";
import { ReprofileForm, VersionStatus } from "../version-parts";
import { routes } from "@/lib/web/routes";
import { loadRepository } from "../load";

const PAGE_SIZE = 25;

export async function generateMetadata({ params }: PageProps<"/repositories/[repositoryId]/versions">): Promise<Metadata> {
  const repository = loadRepository((await params).repositoryId);
  return { title: repository ? `Versions · ${repository.name}` : "Repository not found" };
}

/** Every version of a Repository, its surveys, newest first: why it was queued, its state, and what it profiled (docs/profiling.md). */
export default async function VersionsPage({ params, searchParams }: PageProps<"/repositories/[repositoryId]/versions">) {
  const [{ repositoryId }, query] = await Promise.all([params, searchParams]);
  const repository = loadRepository(repositoryId);
  if (!repository) notFound();
  const db = getDb();
  const total = versionCount(db, repository.id);
  const { page, pages } = pageNumber(param(query, "page"), total, PAGE_SIZE);
  const versions = versionsOf(db, repository.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <IndexTemplate
      header={{
        breadcrumbs: [
          { href: "/repositories", label: "Repositories" },
          { href: routes.repository(repository.publicId), label: repository.name },
        ],
        title: "Versions",
        description: `${countLabel(total, "version")} of ${repository.name}, one survey each of a commit with a Surveyor release and configuration. A version runs when the repository is added, edited, or re-profiled, when its reference has a new commit, when Surveyor is upgraded, and when a Run or a preview needs a commit no version has surveyed.`,
        primaryAction: <ReprofileForm repository={repository} />,
      }}
    >
      <Panel flush>
        {versions.length > 0 ? (
          <Table
            label={`Versions of ${repository.name}`}
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
                    <Link href={routes.repositoryVersion(repository.publicId, version.version)}>{`Version ${version.version}`}</Link>
                  </Primary>
                  <Secondary>{version.requestedBy ? <Link href={routes.run(version.requestedBy.runPublicId)}>{`Run of ${version.requestedBy.name}`}</Link> : TRIGGER_LABELS[version.trigger]}</Secondary>
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
      <Pagination label="Version pages" page={page} pages={pages} href={(number) => routes.repositoryVersions(repository.publicId, number)} />
    </IndexTemplate>
  );
}
