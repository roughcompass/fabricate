import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { BRANDS, templateBySlug } from "@/lib/demo/catalog";
import { applicationNameFor, findRepository, projectByKey } from "@/lib/demo/catalog/repositories";
import { repositoryUrl } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { importRepositoryAction } from "../actions";
import { ImportForm } from "./import-form";

type Params = Record<string, string | string[] | undefined>;

function repositoryFrom(params: Params) {
  const project = param(params, "project") ?? "";
  const name = param(params, "repository") ?? "";
  return findRepository(project, name);
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const repository = repositoryFrom(await searchParams);
  return { title: repository ? `Import ${repository.project}/${repository.name}` : "Repository not found" };
}

/** The import form for one repository in the demo's BitBucket. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<Params> }) {
  requireDemo();
  const repository = repositoryFrom(await searchParams);
  if (!repository) notFound();
  const template = templateBySlug(repository.templateSlug)!;
  const project = projectByKey(repository.project)!;
  const key = `${repository.project}/${repository.name}`;

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/new", label: "New application" },
          { href: `/new?provider=bitbucket${repository.project === "PAY" ? "" : `&project=${repository.project}`}#import`, label: "Import Git Repository" },
        ]}
        title={`Import ${key}`}
        description={`Deploy this repository to a dev environment, rendered in the ${BRANDS[template.brand].portalName} portal. The import and its build are simulated.`}
      />
      <ImportForm
        action={importRepositoryAction.bind(null, repository.project, repository.name)}
        initial={{ values: { name: applicationNameFor(repository) }, errors: {} }}
        cancelHref={`/new?provider=bitbucket${repository.project === "PAY" ? "" : `&project=${repository.project}`}#import`}
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
