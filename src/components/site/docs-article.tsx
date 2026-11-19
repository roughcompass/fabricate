import type { Element, ElementContent, Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import Link from "next/link";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { CopyButton } from "@/components/ui/copy-button";
import styles from "./docs.module.css";

/*
 * A docs page's article, from the HAST its Markdown renders to
 * (src/lib/docs/render.ts): headings keep their anchors, links between pages
 * navigate within the app, code blocks name their language and copy, and
 * wide tables scroll inside their own box.
 */

function textOf(node: ElementContent | Root): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map((child) => textOf(child as ElementContent)).join("") : "";
}

function CodeBlock({ node, children }: { node?: Element; children?: React.ReactNode }) {
  const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
  const language = (code?.properties.className as string[] | undefined)?.find((name) => name.startsWith("language-"))?.slice("language-".length);
  const text = node ? textOf(node).replace(/\n$/, "") : "";
  return (
    <figure className={styles.code} data-panel="">
      <figcaption className={styles.codeCaption}>
        <span>{language ?? "Code"}</span>
        <CopyButton value={text} label="Copy code" />
      </figcaption>
      <pre className={styles.codeBody}>{children}</pre>
    </figure>
  );
}

function Table({ children }: { children?: React.ReactNode }) {
  return (
    <div className={styles.tableScroll} data-panel="" data-scroll-x="" tabIndex={0}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}

function Anchor({ href = "", children }: { href?: string; children?: React.ReactNode }) {
  // Pages of the app and the docs navigate within it; Markdown addresses, the agents' index, and other sites load as documents.
  if (href.startsWith("/") && !/\.(md|txt|json)(#|$)/.test(href)) return <Link href={href}>{children}</Link>;
  return <a href={href}>{children}</a>;
}

export function DocsArticle({ tree }: { tree: Root }) {
  return (
    <div className={styles.prose} data-docs-article="">
      {toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs,
        passNode: true,
        components: {
          pre: CodeBlock,
          table: Table,
          a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
        },
      })}
    </div>
  );
}
