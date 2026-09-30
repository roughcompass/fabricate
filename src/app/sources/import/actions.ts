"use server";

import { redirect } from "next/navigation";
import { confirmImport } from "@/lib/catalog/directory-import";
import { BoundaryViolation } from "@/lib/catalog/source-boundary";
import { getDb } from "@/lib/db/client";
import { text, texts } from "@/lib/web/form-data";

export async function importSources(formData: FormData): Promise<void> {
  const directory = text(formData, "directory", 4_096);
  let created = 0;
  let failed = 0;
  try {
    const result = confirmImport(getDb(), directory, texts(formData, "paths", 4_096));
    created = result.created.length;
    failed = result.failed.length;
  } catch (error) {
    if (error instanceof BoundaryViolation) redirect(`/sources/import?directory=${encodeURIComponent(directory)}`);
    throw error;
  }
  redirect(`/sources?notice=${failed ? "import-partial" : "imported"}&count=${created}&failed=${failed}`);
}
