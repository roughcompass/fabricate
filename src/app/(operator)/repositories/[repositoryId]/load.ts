import { cache } from "react";
import { findRepository } from "@/lib/repositories/repository-records";
import { getDb } from "@/lib/db/client";
import { findVersion } from "@/lib/profiling/versions";

/** A Repository, read once per request and shared by a page and its metadata. */
export const loadRepository = cache((publicId: string) => findRepository(getDb(), publicId));

/** One version of a Repository, a survey, by the number in its address. */
export const loadVersion = cache((publicId: string, number: string) => {
  const repository = loadRepository(publicId);
  const version = repository && /^[1-9][0-9]{0,8}$/.test(number) ? findVersion(getDb(), repository.id, Number(number)) : undefined;
  return repository && version ? { repository, version } : undefined;
});
