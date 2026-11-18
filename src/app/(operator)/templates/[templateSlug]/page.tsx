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
import { acceptedTemplate } from "@/lib/demo/gallery-templates";
import { Status } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { getDb } from "@/lib/db/client";
import { heroStanding } from "@/lib/prototypes/conformance";
import { prototypesEnabled, templatesAvailable } from "@/lib/prototypes/guard";
import { heroFiles, heroTemplate } from "@/lib/prototypes/heroes/use";
import { startFromHeroAction } from "./actions";
import { PrototypeTemplateDetail, StandardsSection } from "./prototype-template";
import styles from "../templates.module.css";

export async function generateMetadata({ params }: { params: Promise<{ templateSlug: string }> }): Promise<Metadata> {
  const { templateSlug } = await params;
  const title = templateBySlug(templateSlug)?.title ?? (await acceptedTemplate(templateSlug))?.latest.title;
  return { title: title ? `${title} · Salt Patterns` : "Template not found" };
}

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ templateSlug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  requireDemo();
  const { templateSlug } = await params;
  const template = templateBySlug(templateSlug);
  if (!template) {
    const accepted = await acceptedTemplate(templateSlug);
    if (!accepted) notFound();
    const notice = (await searchParams)?.notice;
    return <PrototypeTemplateDetail template={accepted} notice={typeof notice === "string" ? notice : undefined} />;
  }
  const brand = BRANDS[template.brand];
  // The template's page, from its committed source: Use template, Generate variations, and its Standards.
  const hero = heroTemplate(template.slug);
  const usable = hero !== null && prototypesEnabled();
  const standing = hero && templatesAvailable() ? await heroStanding(getDb(), hero, heroFiles(hero)) : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/templates", label: "Salt Patterns" }]}
        title={template.title}
        description={template.description}
        extraActions={
          <>
            <ButtonLink href={`/templates/${template.slug}/preview`} icon="eye">
              Preview template
            </ButtonLink>
            {/* A hero is real Salt: while Prototypes is enabled, its main route can start a prototype as one page. */}
            {usable && (
              <>
                <form action={startFromHeroAction}>
                  <input type="hidden" name="slug" value={template.slug} />
                  <SubmitButton icon="plus" variant="secondary" pendingLabel="Starting">
                    Use template
                  </SubmitButton>
                </form>
                <ButtonLink href={`/prototypes/new?${new URLSearchParams({ template: hero!.id })}`} icon="sparkle">
                  Generate variations
                </ButtonLink>
              </>
            )}
          </>
        }
        primaryAction={
          <ButtonLink href={`/templates/${template.slug}/deploy`} variant="primary" icon="cloud">
            Deploy template
          </ButtonLink>
        }
      />

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
              ...(standing ? ([["Standards", <Status key="standards" state={standing.status} label={standing.status === "meets" ? "Meets selected Standards" : undefined} />]] as const) : []),
            ]}
          />
        </div>
        <figure className={styles.preview}>
          <Image src={template.preview.src} alt={template.preview.alt} fill unoptimized sizes="(max-width: 767px) 100vw, 800px" className={styles.previewImage} />
        </figure>
      </div>

      {standing && <StandardsSection standing={standing} hero />}

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
