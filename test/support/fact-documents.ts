import fs from "node:fs";
import path from "node:path";
import type { JsonObject, MemoryFile } from "@repo-facts/contract";
import type { FactDocument } from "@/lib/profiles/states";
import { memoryProfile } from "./profiles";

const DIRECTORY = path.join(import.meta.dirname, "..", "fixtures", "fact-documents");

/** Golden fact documents copied from Surveyor's fixtures, as named in `SOURCE.json`. */
export const FACT_DOCUMENT_FIXTURES = ["federation-shell", "npm-workspace", "salt-application"] as const;

export function factDocumentFixture(name: (typeof FACT_DOCUMENT_FIXTURES)[number]): JsonObject {
  return JSON.parse(fs.readFileSync(path.join(DIRECTORY, `${name}.json`), "utf8")) as JsonObject;
}

/** The fact document the pinned bundle produces for +files+. */
export async function analyzedFacts(files: Readonly<Record<string, MemoryFile>>, name = "app"): Promise<FactDocument> {
  const { document } = await memoryProfile(files, { public_id: `src_${name}`, name });
  return document.fact_document as unknown as FactDocument;
}

/** +document+ as Surveyor release 0.1.0 produced it: without the Interface categories, which that release didn't define. */
export function asRelease010(document: FactDocument): FactDocument {
  const categories = { ...document.categories };
  for (const id of ["design_systems", "ui_elements", "style_values"]) delete categories[id];
  return { ...document, detector_release: "0.1.0", categories };
}
