import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { findRelease, findStandard } from "@/lib/standards/standard-records";

/** A Standard, read once per request and shared by a page and its metadata. */
export const loadStandard = cache((publicId: string) => findStandard(getDb(), publicId));

/** A Release of the Standard +standardId+, or undefined when it belongs to another. */
export const loadRelease = cache((standardId: string, releaseId: string) => {
  const standard = loadStandard(standardId);
  const release = findRelease(getDb(), releaseId);
  return standard && release && release.standardId === standard.id ? { standard, release } : undefined;
});
