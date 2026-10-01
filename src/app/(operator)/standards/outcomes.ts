import type { Outcome } from "@/components/ui/outcome-toast";

/**
 * Messages for the outcome codes Standard actions redirect with. Text is built
 * from the records, never from the URL; an unknown code shows nothing.
 */

export function standardOutcome(code: string | undefined, standard: { name: string; publicId: string }): Outcome | undefined {
  const id = `${code}:${standard.publicId}`;
  switch (code) {
    case "updated":
      return { id, tone: "success", title: `${standard.name} was updated.`, description: "Published Releases keep the name and purpose they were published with." };
    case "draft_exists":
      return { id, tone: "warning", title: "A draft already exists.", description: "Edit or publish it before starting another." };
    case "no_draft":
      return { id, tone: "info", title: "There is no draft to edit.", description: "It may have just been published." };
    default:
      return undefined;
  }
}

export function draftOutcome(code: string | undefined, standard: { name: string; publicId: string }): Outcome | undefined {
  const id = `${code}:${standard.publicId}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${standard.name} was created.`, description: "Add Controls to its draft, then save." };
    case "revision":
      return { id, tone: "success", title: "A new draft was started from the Release.", description: "The Release itself does not change." };
    default:
      return undefined;
  }
}

export function publishOutcome(code: string | undefined, standard: { publicId: string }): Outcome | undefined {
  return code === "stale"
    ? { id: `stale:${standard.publicId}`, tone: "warning", title: "The draft changed after you opened this review.", description: "Check the draft version and Controls again before publishing." }
    : undefined;
}

export function releaseOutcome(code: string | undefined, release: { publicId: string; version: number }): Outcome | undefined {
  return code === "published" ? { id: `published:${release.publicId}`, tone: "success", title: `Release v${release.version} was published.`, description: "Initiatives can now select it." } : undefined;
}
