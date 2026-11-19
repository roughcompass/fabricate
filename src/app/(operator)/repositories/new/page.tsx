import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { createRepository } from "../actions";
import { RepositoryForm } from "../repository-form";

export const metadata: Metadata = { title: "New Repository" };

export default function NewRepositoryPage() {
  return (
    <FormTemplate
      header={{
        breadcrumbs: [{ href: "/repositories", label: "Repositories" }],
        title: "New Repository",
        description: "Register a Git repository. A local file:// Repository must be inside an allowed source root.",
      }}
    >
      <RepositoryForm action={createRepository} initial={{ values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} }} submitLabel="Create Repository" />
    </FormTemplate>
  );
}
