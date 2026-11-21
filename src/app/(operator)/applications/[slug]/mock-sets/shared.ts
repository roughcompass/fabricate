import { notFound } from "next/navigation";
import type { Outcome } from "@/components/ui/outcome-toast";
import { requireApplications } from "@/lib/applications/availability";
import { findApplication, getApplicationRow } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import type { MockSet } from "@/lib/mocks/model";
import { findSet } from "@/lib/mocks/records";

/*
 * What the mock sets' pages share (add-mock-sets, design decision 18):
 * loading the application and set the address names, while applications are
 * offered, and the set page's notices.
 */

/** The application the address names, with its row ID, or the not-found page. */
export function pageApplication(slug: string) {
  requireApplications();
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  return { ...application, id: getApplicationRow(getDb(), application.publicId).id };
}

/** The application and its set the address names, or the not-found page: a set of another application isn't found. */
export function pageSet(slug: string, setPublicId: string) {
  const application = pageApplication(slug);
  const set = isPublicId(setPublicId, "mks") ? findSet(getDb(), application.id, setPublicId) : undefined;
  if (!set) notFound();
  return { application, set };
}

/** The set page's notices, from the code an action redirected with. The text is built from the set, so a crafted link can't inject text. */
export function setOutcome(code: string | undefined, set: MockSet): Outcome | undefined {
  if (!code) return undefined;
  const id = `${code}:${set.publicId}:${set.revision}`;
  const notices: Record<string, Omit<Outcome, "id">> = {
    "set-created": { tone: "success", title: `${set.name} was created.`, description: set.ruleCount ? "Each rule needs a response before it answers anything." : "Add rules, or upload a HAR file." },
    "set-imported": { tone: "success", title: `${set.name} was created from the HAR file.` },
    "rules-imported": { tone: "success", title: `The HAR file's rules were added to ${set.name}.` },
    "set-updated": { tone: "success", title: `${set.name} was updated.` },
    "rule-created": { tone: "success", title: "The rule was added at the end of the set." },
    "rule-updated": { tone: "success", title: "The rule was saved." },
    "rule-deleted": { tone: "success", title: "The rule was deleted." },
    "rules-added": { tone: "success", title: `Rules for the failed calls were added to ${set.name}.`, description: "Each needs a response before it answers anything." },
    "rule-needs-response": { tone: "error", title: "That rule can't be turned on yet.", description: "Write a response for it first." },
    "rule-limit": { tone: "error", title: "That rule couldn't be duplicated.", description: "A mock set can have 500 rules. Delete rules it no longer needs first." },
  };
  const notice = notices[code];
  return notice && { id, ...notice };
}
