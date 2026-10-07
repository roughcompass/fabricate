import type { Choice } from "@/components/ui/form";
import type { Executor } from "@/lib/db/client";
import { applicationOwnership } from "@/lib/ownership/read";
import type { Application } from "@/lib/ownership/records";

/** Applications as choices a person can tell apart: name, then SEAL ID, team, and public ID as details. */
export function applicationChoices(db: Executor, records: readonly Application[]): Choice[] {
  const owned = applicationOwnership(
    db,
    records.map((record) => record.id),
  );
  return records.map((record) => {
    const ownership = owned.get(record.id);
    const details = [record.sealId && `SEAL ID ${record.sealId}`, ownership?.team.value && `Team ${ownership.team.value}`, ownership?.deWeb && "Listed by the DE Console", record.publicId].filter(Boolean);
    return { value: record.publicId, label: record.name ?? "Unnamed application", description: details.join(" · ") };
  });
}
