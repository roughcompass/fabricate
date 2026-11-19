import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsTemplate } from "@/components/templates/settings-template";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
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
 * A Repository's settings, on the Settings template: General, which edits its
 * clone URL, name, and reference, and the danger section, which deletes it.
 */
export default async function SettingsPage({ params, searchParams }: PageProps<"/repositories/[repositoryId]/settings">) {
  const [{ repositoryId }, query] = await Promise.all([params, searchParams]);
  const repository = loadRepository(repositoryId);
  if (!repository) notFound();
  const db = getDb();

  return (
    <SettingsTemplate
      header={{
        breadcrumbs: [
          { href: "/repositories", label: "Repositories" },
          { href: routes.repository(repository.publicId), label: repository.name },
        ],
        title: "Settings",
      }}
      alerts={<OutcomeToast outcome={repositoryOutcome(db, param(query, "notice"), repository.publicId)} />}
      sections={[
        {
          id: "general",
          title: "General",
          description: "Changes apply to Runs started afterward, and a new clone URL or reference surveys the repository again.",
          content: (
            <RepositoryForm
              action={updateRepository.bind(null, repository.publicId)}
              initial={{ values: { name: repository.name, cloneUrl: repository.cloneUrl, gitRef: repository.gitRef ?? "" }, errors: {} }}
              lockVersion={repository.lockVersion}
              submitLabel="Save changes"
              layout="plain"
            />
          ),
        },
      ]}
      danger={{
        description: "Actions here can't be undone.",
        content: (
          <div className={styles.dangerRow}>
            <div>
              <p className={styles.dangerTitle}>Delete this repository</p>
              <p className={styles.muted}>Once you delete a repository, there is no going back. Please be certain.</p>
            </div>
            <DeleteRepository name={repository.name} effects={deletionEffects(db, repository)} action={deleteRepository.bind(null, repository.publicId)} />
          </div>
        ),
      }}
    />
  );
}
