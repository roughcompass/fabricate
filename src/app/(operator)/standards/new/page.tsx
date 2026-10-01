import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { createStandard } from "../actions";
import { StandardForm } from "../standard-form";

export const metadata: Metadata = { title: "New Standard" };

export default function NewStandardPage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/standards", label: "Standards" }]} title="New Standard" description="Name the Standard and describe its purpose; you add Controls in its draft." />
      <StandardForm action={createStandard} initial={{ values: { name: "", purpose: "" }, errors: {} }} submitLabel="Create Standard" cancelHref="/standards" />
    </Page>
  );
}
