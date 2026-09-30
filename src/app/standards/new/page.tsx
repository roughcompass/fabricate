import type { Metadata } from "next";
import { Card, Page, PageHeader } from "@/components/ui/layout";
import { createStandard } from "../actions";
import { StandardForm } from "../standard-form";

export const metadata: Metadata = { title: "New Standard" };

export default function NewStandardPage() {
  return (
    <Page width="narrow">
      <PageHeader title="New Standard" back={{ href: "/standards", label: "Standards" }} description="Name the Standard and describe its purpose. You add Controls in its draft." />
      <Card>
        <StandardForm action={createStandard} initial={{ values: { name: "", purpose: "" }, errors: {} }} submitLabel="Create Standard" cancelHref="/standards" />
      </Card>
    </Page>
  );
}
