import Form from "next/form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HiddenFields, TextInput } from "@/components/ui/form";
import type { RefChoices } from "@/lib/applications/preview-mode";
import { branchLabel } from "@/lib/applications/records";
import { SAVED_PREVIEW_LIMIT } from "@/lib/applications/saved-previews";
import styles from "./preview/preview.module.css";

/*
 * The branch or tag choice that preview mode and New preview share
 * (template-preview spec, "Preview mode can show another branch or tag";
 * applications/saved-previews spec, "Saved previews are created from the
 * application page or preview mode"): the tracked branch first, then the
 * application's saved previews, then the remote's other branches and tags,
 * and a search for the ones the choice leaves out. Both work without
 * JavaScript.
 */

type Option = { value: string; label: string } | { label: string; options: { value: string; label: string }[] };

/** The choice's options, each a qualified ref; empty groups are left out. */
export function refOptions(choices: RefChoices): Option[] {
  const groups: Option[] = [
    { value: choices.tracked, label: `${branchLabel(choices.tracked)} (tracked)` },
    { label: "Saved previews", options: choices.saved.map((saved) => ({ value: saved.ref, label: saved.label })) },
    { label: "Branches", options: choices.branches.map((ref) => ({ value: ref.name, label: ref.label })) },
    { label: "Tags", options: choices.tags.map((ref) => ({ value: ref.name, label: ref.label })) },
  ];
  return groups.filter((option) => !("options" in option) || option.options.length > 0);
}

/** How many more previews an application with +saved+ of them can keep, said once five or fewer remain; null before then. */
export function remainingPreviews(saved: number): string | null {
  const remaining = Math.max(0, SAVED_PREVIEW_LIMIT - saved);
  if (remaining > 5) return null;
  if (remaining === 0) return `This application keeps ${SAVED_PREVIEW_LIMIT} previews, the most it can. Remove a preview to save another.`;
  return remaining === 1 ? "1 more preview can be saved." : `${remaining} more previews can be saved.`;
}

/**
 * Finding a branch or tag the choice doesn't list (a remote can have
 * thousands of tags): shown once the choice leaves some out, or while it
 * lists a search's matches. A plain GET form to +action+, so it works
 * without JavaScript, keeping the +hidden+ fields, such as the ref shown and
 * the device. +clearHref+ ends the search.
 */
export function RefFinder({ action, hidden, choices, clearHref }: { action: string; hidden: Record<string, string | null | undefined>; choices: RefChoices; clearHref: string }) {
  const listed = choices.branches.length + choices.tags.length;
  const leftOut = choices.total.branches > choices.branches.length || choices.total.tags > choices.tags.length;
  if (!choices.find && !leftOut) return null;
  const count = (shown: number, total: number, [one, many]: [string, string], order: string) => (shown >= total ? `every ${one}` : `${order}${shown} of ${total} ${many}`);
  const summary = choices.find
    ? `${choices.find.matched === 1 ? "1 branch or tag matches" : `${choices.find.matched} branches and tags match`} “${choices.find.text}”${choices.find.matched > listed ? `; the first ${listed} are listed. Find more of the name to narrow them.` : "."}`
    : `The list has ${count(choices.branches.length, choices.total.branches, ["branch", "branches"], "")} and ${count(choices.tags.length, choices.total.tags, ["tag", "tags"], "the highest-numbered ")}. Find a branch or tag by name to choose another.`;
  return (
    <div className={styles.finder}>
      <Form action={action} className={styles.findForm} role="search" aria-label="Find a branch or tag">
        <HiddenFields values={hidden} />
        <TextInput id="preview-find" name="find" type="search" label="Find a branch or tag" hideLabel size="sm" placeholder="Find a branch or tag" defaultValue={choices.find?.text ?? ""} />
        <Button type="submit" size="sm">
          Find
        </Button>
        {choices.find && <Link href={clearHref}>Clear</Link>}
      </Form>
      <p className={styles.muted} role="status">
        {summary}
      </p>
    </div>
  );
}
