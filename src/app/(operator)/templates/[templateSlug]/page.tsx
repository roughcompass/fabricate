import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TagList } from "@/components/ui/tag";
import { BRANDS, PROVIDERS, routingLabel, templateBySlug } from "@/lib/demo/catalog";
import { requireDemo } from "@/lib/demo/guard";
import styles from "../templates.module.css";

export async function generateMetadata({ params }: { params: Promise<{ templateSlug: string }> }): Promise<Metadata> {
  const template = templateBySlug((await params).templateSlug);
  return { title: template ? `${template.title} · Templates` : "Template not found" };
}

export default async function TemplatePage({ params }: { params: Promise<{ templateSlug: string }> }) {
  requireDemo();
  const template = templateBySlug((await params).templateSlug);
  if (!template) notFound();
  const brand = BRANDS[template.brand];

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/templates", label: "Templates" }]}
        title={template.title}
        description={template.description}
        extraActions={
          <ButtonLink href={`/templates/${template.slug}/preview`} icon="eye">
            Preview template
          </ButtonLink>
        }
        primaryAction={
          <ButtonLink href={`/templates/${template.slug}/deploy`} variant="primary" icon="cloud">
            Deploy template
          </ButtonLink>
        }
      />

      <div className={styles.detail}>
        <div className={styles.overview}>
          <DescriptionList
            items={[
              ["Brand", brand.label],
              ["Portal", brand.portalName],
              ["Provider", template.provider === "community" ? `${PROVIDERS.community.label} · ${template.author}` : PROVIDERS["de-web"].label],
              ["Version", template.version],
              ["Microfrontends", template.app.members.filter((member) => member.role === "child").map((member) => member.name).join(", ")],
              ["Tags", <TagList key="tags" values={template.tags} />],
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
    </Page>
  );
}
