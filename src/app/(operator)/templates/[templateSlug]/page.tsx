import type { Metadata } from "next";
import { DetailsTemplate } from "@/components/templates/details-template";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TagList } from "@/components/ui/tag";
import { BRANDS, PROVIDERS, routingLabel, templateBySlug } from "@/lib/demo/catalog";
import { requireDemo } from "@/lib/demo/guard";
import styles from "../templates.module.css";

export async function generateMetadata({ params }: PageProps<"/templates/[templateSlug]">): Promise<Metadata> {
  const { templateSlug } = await params;
  const title = templateBySlug(templateSlug)?.title;
  return { title: title ? `${title} · Salt Patterns` : "Template not found" };
}

export default async function TemplatePage({ params }: PageProps<"/templates/[templateSlug]">) {
  requireDemo();
  const { templateSlug } = await params;
  const template = templateBySlug(templateSlug);
  if (!template) notFound();
  const brand = BRANDS[template.brand];

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: [{ href: "/templates", label: "Salt Patterns" }],
        title: template.title,
        description: template.description,
        extraActions: <ButtonLink href={`/templates/${template.slug}/preview`} icon="eye">
          Preview template
        </ButtonLink>,
      }}
    >

      <div className={styles.detail}>
        <div className={styles.overview}>
          <DescriptionList surface
            items={[
              ["Brand", brand.label],
              ["Portal", brand.portalName],
              ["Provider", template.provider === "community" ? `${PROVIDERS.community.label} · ${template.author}` : PROVIDERS["de-web"].label],
              ["Version", template.version],
              ["Microfrontends", template.app.members.filter((member) => member.role === "child").map((member) => member.name).join(", ")],
              ["Tags", <TagList key="tags" values={template.tags} />],
              ...(template.hero ? [] : ([["Code", <span key="code" data-illustrative="">Illustrative: its code is generated from the template&apos;s description, not real Salt.</span>]] as const)),
            ]}
          />
        </div>
        <figure className={styles.preview}>
          <Image src={template.preview.src} alt={template.preview.alt} fill unoptimized sizes="(max-width: 767px) 100vw, 800px" className={styles.previewImage} />
        </figure>
      </div>

      <Section title="Microfrontends" description={`Each application from this template is a microfrontends group in the ${brand.portalName} portal.`}>
        <Panel flush>
          <Table
            label="Microfrontends in this template"
            head={
              <>
                <Th>Microfrontend</Th>
                <Th>Routing</Th>
                <Th>Owner</Th>
                <Th>Versions</Th>
              </>
            }
          >
            {template.app.members.map((member) => (
              <tr key={member.id}>
                <Td label="Microfrontend">
                  <Primary>{member.name}</Primary>
                  {member.role === "default" && <Secondary>Default application</Secondary>}
                </Td>
                <Td label="Routing">{routingLabel(member)}</Td>
                <Td label="Owner">{member.owner}</Td>
                <Td label="Versions">{member.versions.map((version) => version.version).join(", ")}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>
    </DetailsTemplate>
  );
}
