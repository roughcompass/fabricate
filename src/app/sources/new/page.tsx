import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { createSource } from "../actions";
import { SourceForm } from "../source-form";

export const metadata: Metadata = { title: "New Source" };

export default function NewSourcePage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/sources", label: "Sources" }]} title="New Source" description="Register a Git repository. A local file:// Source must be inside an allowed source root." />
      <SourceForm action={createSource} initial={{ values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} }} submitLabel="Create Source" />
    </Page>
  );
}
