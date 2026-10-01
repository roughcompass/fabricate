import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { createSource } from "../actions";
import { SourceForm } from "../source-form";

export const metadata: Metadata = { title: "New Repository" };

export default function NewSourcePage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/repositories", label: "Repositories" }]} title="New Repository" description="Register a Git repository. A local file:// Repository must be inside an allowed source root." />
      <SourceForm action={createSource} initial={{ values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} }} submitLabel="Create Repository" />
    </Page>
  );
}
