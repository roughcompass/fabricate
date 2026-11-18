import { countLabel } from "@/components/ui/count";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { SearchField } from "@/components/ui/search-field";
import { dependencyKind } from "@/components/ui/status";
import type { DependencyFilters as Filters, SharedBlock } from "@/lib/profiles/view";
import styles from "./profile.module.css";

/** The Dependencies table's filters: by kind and manifest, and a search by package name, applied in place and kept in the URL. */
export function DependencyFilters({ block, filters, action, tab, shown, total }: { block: SharedBlock; filters: Filters; action: string; tab: string; shown: number; total: number }) {
  const rows = block.groups.flatMap((group) => group.rows);
  const kinds = [...new Set(rows.map((row) => row.field).filter((field): field is string => field !== null))];
  const manifests = [...new Set(rows.map((row) => row.manifest).filter((manifest): manifest is string => manifest !== null))];
  const filtered = Boolean(filters.kind || filters.manifest || filters.package);
  return (
    <>
      <FilterBar key={JSON.stringify(filters)} action={action} label="Filter dependencies" filtered={filtered} clearHref={`${action.split("#")[0]}?tab=${tab}#dependencies`} keep={{ tab }}>
        <Select id="filter-kind" name="kind" label="Kind" size="sm" defaultValue={filters.kind ?? ""} options={[{ value: "", label: "Any kind" }, ...kinds.map((kind) => ({ value: kind, label: `${dependencyKind(kind)} (${rows.filter((row) => row.field === kind).length})` }))]} />
        {manifests.length > 1 && <Select id="filter-manifest" name="manifest" label="Manifest" size="sm" defaultValue={filters.manifest ?? ""} options={[{ value: "", label: "Any manifest" }, ...manifests.map((manifest) => ({ value: manifest, label: manifest }))]} />}
        <SearchField id="filter-package" name="package" label="Package" hideLabel size="sm" placeholder="Search by package name" defaultValue={filters.package ?? ""} />
      </FilterBar>
      {filtered && <p className={styles.muted} role="status">{`Showing ${shown} of ${countLabel(total, "dependency", "dependencies")}`}</p>}
    </>
  );
}
