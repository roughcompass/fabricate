import { Fragment } from "react";
import { type CommentNode, formatComment } from "@/lib/workspaces/comment-format";
import styles from "./comments.module.css";

function render(nodes: readonly CommentNode[]): React.ReactNode[] {
  return nodes.map((node, index) => {
    if (typeof node === "string") return <Fragment key={index}>{node}</Fragment>;
    switch (node.style) {
      case "break":
        return <br key={index} />;
      case "strong":
        return <strong key={index}>{render(node.children)}</strong>;
      case "em":
        return <em key={index}>{render(node.children)}</em>;
      case "s":
        return <s key={index}>{render(node.children)}</s>;
      case "code":
        return (
          <code key={index} className={styles.inlineCode}>
            {render(node.children)}
          </code>
        );
    }
  });
}

/**
 * A comment's text with its formatting: bold, italic, strikethrough, and
 * inline code, as elements. Everything else, HTML included, is shown as
 * text, so a comment can never add markup or script to the page.
 */
export function CommentBody({ body }: { body: string }) {
  return <>{render(formatComment(body))}</>;
}
