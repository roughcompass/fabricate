"use server";

import { redirect } from "next/navigation";
import { confirmImport } from "@/lib/catalog/directory-import";
import { BoundaryViolation } from "@/lib/catalog/source-boundary";
import { getDb } from "@/lib/db/client";
import { text, texts } from "@/lib/web/form-data";

export async function importSources(formData: FormData): Promise<void> {
  const directory = text(formData, "directory", 4_096);
  const paths = texts(formData, "paths", 4_096);
  // Nothing selected is a mistake to correct, not a successful import of nothing.
  if (paths.length === 0) redirect(`/repositories/import?directory=${encodeURIComponent(directory)}&notice=none-selected`);
  let created = 0;
  let failed = 0;
  try {
    const result = confirmImport(getDb(), directory, paths);
    created = result.created.length;
    failed = result.failed.length;
  } catch (error) {
    if (error instanceof BoundaryViolation) redirect(`/repositories/import?directory=${encodeURIComponent(directory)}`);
    throw error;
  }
  redirect(`/repositories?notice=${failed ? "import-partial" : "imported"}&count=${created}&failed=${failed}`);
}
