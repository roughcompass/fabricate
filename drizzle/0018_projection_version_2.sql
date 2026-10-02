CREATE TABLE `graph_edge_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`map_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`edge_id` text NOT NULL,
	`candidate_node` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`map_id`) REFERENCES `relationship_maps`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "graph_edge_candidates_document_digest" CHECK(length("graph_edge_candidates"."document_digest") = 64),
	CONSTRAINT "graph_edge_candidates_projection_version" CHECK("graph_edge_candidates"."projection_version" >= 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_edge_candidates_map_edge_node` ON `graph_edge_candidates` (`map_id`,`edge_id`,`candidate_node`);--> statement-breakpoint
CREATE INDEX `graph_edge_candidates_map_node` ON `graph_edge_candidates` (`map_id`,`candidate_node`);--> statement-breakpoint
ALTER TABLE `graph_edges` ADD `reference_type` text;--> statement-breakpoint
ALTER TABLE `graph_edges` ADD `reference_identifier` text;--> statement-breakpoint
ALTER TABLE `graph_edges` ADD `kind` text;--> statement-breakpoint
CREATE INDEX `graph_edges_map_kind_type` ON `graph_edges` (`map_id`,`kind`,`type`);