import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { BRANDS, templateBySlug } from "@/lib/demo/catalog";
import { applicationNameFor, findRepository, projectByKey } from "@/lib/demo/catalog/repositories";
import { repositoryUrl } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { importPageHref } from "@/lib/demo/prompt";
import { importRepositoryAction } from "../../actions";
import { ImportForm } from "../../import-form";

type Params = Promise<{ project: string; repository: string }>;

async function repositoryFrom(params: Params) {
  const { project, repository } = await params;
  return findRepository(project, repository);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const repository = await repositoryFrom(params);
  return { title: repository ? `Import ${repository.project}/${repository.name}` : "Repository not found" };
}

/** The import form for one repository in the demo's BitBucket (deployments spec). */
export default async function ImportPage({ params }: { params: Params }) {
  requireDemo();
  const repository = await repositoryFrom(params);
  if (!repository) notFound();
  const template = templateBySlug(repository.templateSlug)!;
  const project = projectByKey(repository.project)!;
  const key = `${repository.project}/${repository.name}`;
  // The breadcrumb and Cancel return to the import page with this repository's project chosen.
  const back = importPageHref(repository.project);

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/applications", label: "Applications" },
          { href: back, label: "Import from BitBucket" },
        ]}
        title={`Import ${key}`}
        description={`Deploy this repository to a dev environment, rendered in the ${BRANDS[template.brand].portalName} portal. The import and its build are simulated.`}
      />
      <ImportForm
        action={importRepositoryAction.bind(null, repository.project, repository.name)}
        initial={{ values: { name: applicationNameFor(repository) }, errors: {} }}
        cancelHref={back}
        summary={[
          { term: "Repository", value: key, mono: true },
          { term: "Project", value: `${project.key} · ${project.name}` },
          { term: "Branch", value: repository.defaultBranch, mono: true },
          { term: "Location", value: repositoryUrl(repository.project, repository.name), mono: true },
          { term: "Template", value: template.title },
          { term: "Environment", value: "Dev environment" },
        ]}
      />
    </Page>
  );
}
