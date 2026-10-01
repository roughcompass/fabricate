import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { listApplications } from "@/lib/demo/applications";
import { BITBUCKET_HOST } from "@/lib/demo/bitbucket";
import { BITBUCKET_PROJECTS, DEFAULT_PROJECT, projectByKey, repositoriesIn } from "@/lib/demo/catalog/repositories";
import { requireDemo } from "@/lib/demo/guard";
import { importHref, importPageHref } from "@/lib/demo/prompt";
import { currentWorkspace } from "@/lib/demo/request";
import styles from "./import.module.css";

export const metadata: Metadata = { title: "Import from BitBucket" };

const UPDATED = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Import from BitBucket (deployments spec): the demo's BitBucket projects and
 * their repositories, each opening its import form. Only BitBucket is offered.
 */
export default async function ImportFromBitBucketPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  requireDemo();
  const project = projectByKey(param(await searchParams, "project") ?? "") ?? projectByKey(DEFAULT_PROJECT)!;
  const workspace = await currentWorkspace();
  const existing = new Set(workspace ? listApplications(getDb(), workspace.id).map((application) => `${application.bitbucketProject}/${application.bitbucketRepository}`) : []);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/applications", label: "Applications" }]}
        title="Import from BitBucket"
        description={`Choose a repository in the demo's BitBucket, ${BITBUCKET_HOST}, to deploy to a dev environment. Imports are simulated.`}
      />

      <Panel title="Repositories" description={`Repositories in the ${project.key} project.`}>
        <div className={styles.import}>
          <FilterBar action="/applications/import" label="BitBucket project" filtered={false} clearHref={importPageHref()}>
            <Select id="import-project" name="project" label="Project" size="sm" defaultValue={project.key} options={BITBUCKET_PROJECTS.map((entry) => ({ value: entry.key, label: `${entry.key} · ${entry.name}` }))} />
          </FilterBar>
          <ul className={styles.repositories} aria-label={`Repositories in ${project.key}`}>
            {repositoriesIn(project.key).map((repository) => {
              const key = `${repository.project}/${repository.name}`;
              return (
                <li key={key} className={styles.repository} data-repository={key}>
                  <Icon name="git" size={16} className={styles.repositoryIcon} />
                  <span className={styles.repositoryText}>
                    <span className={styles.repositoryName}>{repository.name}</span>
                    <span className={styles.repositoryMeta}>{`${repository.description} Updated ${UPDATED.format(new Date(`${repository.updated}T00:00:00Z`))} on ${repository.defaultBranch}.`}</span>
                  </span>
                  {existing.has(key) && <Tag sans>In your workspace</Tag>}
                  <ButtonLink href={importHref(repository.project, repository.name)} size="sm" aria-label={`Import ${key}`}>
                    Import
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>
    </Page>
  );
}
