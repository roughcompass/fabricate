import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { HeaderLink } from "@/components/ui/page";
import { type DocsPage, docsSite, findPage } from "@/lib/docs/site";
import styles from "./docs-help.module.css";

/*
 * Links from the interface to the docs (product-site spec, "The interface
 * links to the documentation where it helps"): a page whose terms need
 * explaining links to the docs page that explains them, and the link names
 * that page by its title, as the docs list it.
 */

/** The docs page at +path+, such as `guides/adoption`; it fails loudly when the docs no longer have it. */
function docsPage(path: string): DocsPage {
  const page = findPage(docsSite(), path);
  if (!page || page.path !== path) throw new Error(`The docs have no page ${path}`);
  return page;
}

/** A page header action that opens the docs page at +path+: "Docs: " and its title. */
export function docsAction(path: string): HeaderLink {
  const page = docsPage(path);
  return { href: page.href, label: `Docs: ${page.title}`, icon: "file" };
}

/** A line after a page's content that opens the docs page at +path+, for a page whose header has no room. */
export function DocsHelp({ path }: { path: string }) {
  const page = docsPage(path);
  return (
    <p className={styles.help} data-docs-help="">
      <Icon name="file" size={14} />
      <span>Docs:</span>
      <Link href={page.href}>{page.title}</Link>
    </p>
  );
}
