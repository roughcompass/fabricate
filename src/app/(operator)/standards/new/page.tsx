import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { STARTERS, findStarter } from "@/lib/standards/starters";
import { createStandard } from "../actions";
import { StandardForm } from "../standard-form";

export const metadata: Metadata = { title: "New Standard" };

const BLANK = "blank";

export default async function NewStandardPage({ searchParams }: PageProps<"/standards/new">) {
  const requested = (await searchParams).starter;
  const starter = findStarter(typeof requested === "string" ? requested : null);

  return (
    <FormTemplate
      header={{
        breadcrumbs: [{ href: "/standards", label: "Standards" }],
        title: "New Standard",
        description: starter ? "The draft starts with the starter's Controls; review and change them before you publish." : "Name the Standard and describe its purpose; you add Controls in its draft.",
      }}
    >
      <ToggleGroup action="/standards/new" label="Start from" name="starter" selected={starter?.id ?? BLANK} options={[{ value: BLANK, label: "Blank" }, ...STARTERS.map((item) => ({ value: item.id, label: item.label }))]} />
      <StandardForm
        key={starter?.id ?? BLANK}
        action={createStandard}
        initial={{ values: { name: starter?.name ?? "", purpose: starter?.purpose ?? "" }, errors: {} }}
        submitLabel="Create Standard"
        cancelHref="/standards"
        {...(starter && { starter: starter.id })}
      />
    </FormTemplate>
  );
}
