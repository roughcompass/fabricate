-- The projection keeps only facts (prune-and-consolidate-code, design
-- decision 11). Which targets a Run's map is missing comes from the targets'
-- own state and failure code, so projection_coverage goes. projection_state
-- existed so triggers could refuse to delete projection rows outside a
-- rebuild; the projection is derived data rebuilt in one transaction, so the
-- flag and those triggers go. The triggers that refuse updates stay.
DROP TRIGGER dependency_facts_removed_by_rebuild;--> statement-breakpoint
DROP TRIGGER evidence_index_removed_by_rebuild;--> statement-breakpoint
DROP TRIGGER graph_edge_candidates_removed_by_rebuild;--> statement-breakpoint
DROP TRIGGER graph_edges_removed_by_rebuild;--> statement-breakpoint
DROP TRIGGER graph_nodes_removed_by_rebuild;--> statement-breakpoint
DROP TABLE `projection_coverage`;--> statement-breakpoint
DROP TABLE `projection_state`;
