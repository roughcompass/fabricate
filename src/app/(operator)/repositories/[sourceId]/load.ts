import { cache } from "react";
import { findSource } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findVersion } from "@/lib/profiling/versions";

/** A Repository, read once per request and shared by a page and its metadata. */
export const loadRepository = cache((publicId: string) => findSource(getDb(), publicId));

/** One profile version of a Repository, by the number in its address. */
export const loadVersion = cache((publicId: string, number: string) => {
  const source = loadRepository(publicId);
  const version = source && /^[1-9][0-9]{0,8}$/.test(number) ? findVersion(getDb(), source.id, Number(number)) : undefined;
  return source && version ? { source, version } : undefined;
});
