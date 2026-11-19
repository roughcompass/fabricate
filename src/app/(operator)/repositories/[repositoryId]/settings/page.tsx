import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { SectionNav } from "@/components/ui/section-nav";
import { deletionEffects } from "@/lib/repositories/registration";
import { getDb } from "@/lib/db/client";
import { deleteRepository, updateRepository } from "../../actions";
import { repositoryOutcome } from "../../outcomes";
import { RepositoryForm } from "../../repository-form";
import { DeleteRepository } from "./delete-repository";
import styles from "./settings.module.css";
import { routes } from "@/lib/web/routes";
import { loadRepository } from "../load";

export async function generateMetadata({ params }: PageProps<"/repositories/[repositoryId]/settings">): Promise<Metadata> {
  const repository = loadRepository((await params).repositoryId);
  return { title: repository ? `Settings · ${repository.name}` : "Repository not found" };
}

/**
 * A Repository's settings, laid out as GitHub lays out a repository's: a
 * section menu beside General, which edits its clone URL, name, and
 * reference, and the Danger Zone, which deletes it.
 */
export default async function SettingsPage({ params, searchParams }: PageProps<"/repositories/[repositoryId]/settings">) {
  const [{ repositoryId }, query] = await Promise.all([params, searchParams]);
  const repository = loadRepository(repositoryId);
  if (!repository) notFound();
  const db = getDb();

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/repositories", label: "Repositories" },
          { href: routes.repository(repository.publicId), label: repository.name },
        ]}
        title="Settings"
        alerts={<OutcomeToast outcome={repositoryOutcome(db, param(query, "notice"), repository.publicId)} />}
      />
      <div className={styles.layout}>
        <SectionNav
          label="Settings sections"
          groups={[
            {
              label: "Repository",
              items: [
                { id: "general", label: "General" },
                { id: "danger-zone", label: "Danger Zone" },
              ],
            },
          ]}
        />
        <div className={styles.content}>
          <section id="general" aria-labelledby="general-heading" className={styles.section}>
            <h2 id="general-heading" className={styles.heading}>
              General
            </h2>
            <p className={styles.muted}>Changes apply to Runs started afterward, and a new clone URL or reference surveys the repository again.</p>
            <RepositoryForm
              action={updateRepository.bind(null, repository.publicId)}
              initial={{ values: { name: repository.name, cloneUrl: repository.cloneUrl, gitRef: repository.gitRef ?? "" }, errors: {} }}
              lockVersion={repository.lockVersion}
              submitLabel="Save changes"
              layout="plain"
            />
          </section>

          <section id="danger-zone" aria-labelledby="danger-heading" className={styles.section}>
            <h2 id="danger-heading" className={styles.heading}>
              Danger Zone
            </h2>
            <div className={styles.dangerZone}>
              <div className={styles.dangerRow}>
                <div>
                  <p className={styles.dangerTitle}>Delete this repository</p>
                  <p className={styles.muted}>Once you delete a repository, there is no going back. Please be certain.</p>
                </div>
                <DeleteRepository name={repository.name} effects={deletionEffects(db, repository)} action={deleteRepository.bind(null, repository.publicId)} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
