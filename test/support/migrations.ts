import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIGRATIONS_FOLDER } from "@/lib/db/client";

/** A copy of the committed migrations up to and including +tag+, to migrate a test database to an earlier schema. */
export function migrationFolderAt(tag: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-migrations-"));
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
  const selected = journal.entries.find((entry) => entry.tag === tag);
  if (!selected) throw new Error(`Migration ${tag} does not exist`);
  for (const entry of journal.entries.filter((candidate) => candidate.idx > selected.idx)) fs.rmSync(path.join(folder, `${entry.tag}.sql`), { force: true });
  journal.entries = journal.entries.filter((entry) => entry.idx <= selected.idx);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}
