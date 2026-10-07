import type { ReactNode } from "react";
import { DescriptionList } from "@/components/ui/description-list";
import { FormNote } from "@/components/ui/form";
import type { Legacy } from "@/lib/onboarding/formats";

/**
 * What a converted Draft kept from its earlier-format revision: the values
 * the earlier format collected and this one no longer does, shown as
 * history only. +replacement+ says where each decision is made now.
 */
export function RetainedHistory({ legacy, items, replacement }: { legacy: Legacy; items: readonly (readonly [string, ReactNode])[]; replacement: string }) {
  if (items.length === 0) return null;
  return (
    <FormNote title={`Kept from revision ${legacy.fromRevision}, as history`} icon="clock">
      <p>{`Revision ${legacy.fromRevision} was written in the earlier format, which collected these values. They're kept here for reference, aren't collected any more, and won't be submitted. ${replacement}`}</p>
      <DescriptionList items={items} />
    </FormNote>
  );
}

/** A retained value as text: a list joined, an object as compact JSON. */
export function retained(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.length ? value.join(", ") : "None";
  return typeof value === "string" ? value : JSON.stringify(value);
}
