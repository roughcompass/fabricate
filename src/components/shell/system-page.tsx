import Link from "next/link";
import { SystemTemplate } from "@/components/templates/system-template";
import { buttonProps } from "@/components/ui/button-content";
import { HOME } from "./navigation";

/**
 * A record that does not exist, on the System template, with a link to the
 * list of its section. `sentenceNoun` is the noun mid-sentence, for nouns
 * that are not capitalized domain terms. An area that can be turned off, such
 * as Applications while previews are off, passes `available`: while it's
 * false the whole area is unavailable, so the page names no record and links
 * to Home, never back to a page that is itself not found (page-patterns spec,
 * not-found states).
 */
export function NotFoundPage({ noun, listHref, listLabel, sentenceNoun, available = true }: { noun: string; listHref: string; listLabel: string; sentenceNoun?: string; available?: boolean }) {
  if (!available) {
    return <NotFoundPage noun="Page" listHref={HOME.href} listLabel={HOME.label} />;
  }
  return (
    <SystemTemplate
      icon="help"
      title={`${noun} not found`}
      actions={
        <Link href={listHref} {...buttonProps("primary")}>
          {`Go to ${listLabel}`}
        </Link>
      }
    >
      <p>{`This ${sentenceNoun ?? (noun === "Page" ? "page" : noun)} does not exist. It may have been deleted, or the address may be mistyped.`}</p>
    </SystemTemplate>
  );
}
