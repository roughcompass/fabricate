import type { Metadata } from "next";
import { Card, Page, PageHeader } from "@/components/ui/layout";
import { createSource } from "../actions";
import { SourceForm } from "../source-form";

export const metadata: Metadata = { title: "Add source" };

export default function NewSourcePage() {
  return (
    <Page width="narrow">
      <PageHeader
        title="Add source"
        back={{ href: "/sources", label: "Sources" }}
        description="Register a Git repository. Local file:// sources must resolve inside an allowed source root."
      />
      <Card>
        <SourceForm action={createSource} initial={{ values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} }} submitLabel="Add source" />
      </Card>
    </Page>
  );
}
