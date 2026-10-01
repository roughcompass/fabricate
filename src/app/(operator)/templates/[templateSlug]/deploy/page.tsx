import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { BRANDS, templateBySlug } from "@/lib/demo/catalog";
import { defaultRepositoryName } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { createApplicationAction } from "./actions";
import { DeployForm } from "./deploy-form";

export async function generateMetadata({ params }: { params: Promise<{ templateSlug: string }> }): Promise<Metadata> {
  const template = templateBySlug((await params).templateSlug);
  return { title: template ? `Deploy ${template.title}` : "Template not found" };
}

export default async function DeployPage({ params }: { params: Promise<{ templateSlug: string }> }) {
  requireDemo();
  const template = templateBySlug((await params).templateSlug);
  if (!template) notFound();

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/templates", label: "Templates" },
          { href: `/templates/${template.slug}`, label: template.title },
        ]}
        title={`Deploy ${template.title}`}
        description={`Create an application from this template, rendered in the ${BRANDS[template.brand].portalName} portal. Builds and deployments are simulated.`}
      />
      <DeployForm
        action={createApplicationAction.bind(null, template.slug)}
        initial={{ values: { name: template.title, environment: "sandbox", project: "", repository: defaultRepositoryName(template.title) }, errors: {} }}
        cancelHref={`/templates/${template.slug}`}
      />
    </Page>
  );
}
