import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { addRepositoriesInBulk } from "../actions";
import { BulkForm } from "./bulk-form";

export const metadata: Metadata = { title: "Add Repositories" };

/** Add Repositories in bulk: paste clone URLs, one per line. */
export default function BulkPage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/repositories", label: "Repositories" }]} title="Add Repositories" description="Register many Git repositories at once. A local file:// Repository must be inside an allowed source root." />
      <BulkForm action={addRepositoriesInBulk} initial={{ values: { urls: "" }, errors: {}, added: 0, failed: [] }} />
    </Page>
  );
}
