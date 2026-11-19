import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DocsView } from "@/components/site/docs-view";
import { docsSite, readDocPage } from "@/lib/docs/site";

/** A docs page's title and summary, and its Markdown, linked as an alternate for agents. */
export async function generateMetadata({ params }: PageProps<"/docs/[[...path]]">): Promise<Metadata> {
  const { path = [] } = await params;
  const doc = path.length ? readDocPage(docsSite(), path.join("/")) : undefined;
  if (!doc) return {};
  return { title: doc.page.title, description: doc.page.summary, alternates: { types: { "text/markdown": doc.page.markdownHref } } };
}

/** The docs (product-site spec): the docs' own address opens their first page. */
export default async function DocsPage({ params }: PageProps<"/docs/[[...path]]">) {
  const { path = [] } = await params;
  const site = docsSite();
  if (path.length === 0) redirect(site.pages[0]!.href);
  const doc = readDocPage(site, path.join("/"));
  if (!doc) notFound();
  return <DocsView site={site} doc={doc} />;
}
