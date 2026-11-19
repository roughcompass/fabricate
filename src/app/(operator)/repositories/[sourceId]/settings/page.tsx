import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { SectionNav } from "@/components/ui/section-nav";
import { deletionEffects } from "@/lib/catalog/catalog";
import { getDb } from "@/lib/db/client";
import { deleteRepository, updateSource } from "../../actions";
import { sourceOutcome } from "../../outcomes";
import { SourceForm } from "../../source-form";
import { DeleteRepository } from "./delete-repository";
import styles from "./settings.module.css";
import { routes } from "@/lib/web/routes";
import { loadRepository } from "../load";

export async function generateMetadata({ params }: PageProps<"/repositories/[sourceId]/settings">): Promise<Metadata> {
  const source = loadRepository((await params).sourceId);
  return { title: source ? `Settings · ${source.name}` : "Repository not found" };
}

/**
 * A Repository's settings, laid out as GitHub lays out a repository's: a
 * section menu beside General, which edits its clone URL, name, and
 * reference, and the Danger Zone, which deletes it.
 */
export default async function SettingsPage({ params, searchParams }: PageProps<"/repositories/[sourceId]/settings">) {
  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const source = loadRepository(sourceId);
  if (!source) notFound();
  const db = getDb();

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/repositories", label: "Repositories" },
          { href: routes.repository(source.publicId), label: source.name },
        ]}
        title="Settings"
        alerts={<OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), source.publicId)} />}
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
            <p className={styles.muted}>Changes apply to Runs started afterward, and a new clone URL or reference queues a new profile version.</p>
            <SourceForm
              action={updateSource.bind(null, source.publicId)}
              initial={{ values: { name: source.name, cloneUrl: source.cloneUrl, gitRef: source.gitRef ?? "" }, errors: {} }}
              lockVersion={source.lockVersion}
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
                <DeleteRepository name={source.name} effects={deletionEffects(db, source)} action={deleteRepository.bind(null, source.publicId)} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
