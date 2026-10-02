CREATE TABLE `ontology_concepts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`concept_key` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`lifecycle` text NOT NULL,
	`owner` text NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `ontology_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ontology_concepts_key_format" CHECK(length("ontology_concepts"."concept_key") BETWEEN 3 AND 200 AND "ontology_concepts"."concept_key" GLOB '*/*'),
	CONSTRAINT "ontology_concepts_label" CHECK(length(trim("ontology_concepts"."label")) BETWEEN 1 AND 200),
	CONSTRAINT "ontology_concepts_lifecycle" CHECK(lifecycle IN ('adopt', 'hold', 'retire')),
	CONSTRAINT "ontology_concepts_owner" CHECK(length(trim("ontology_concepts"."owner")) > 0),
	CONSTRAINT "ontology_concepts_document" CHECK(json_valid("ontology_concepts"."document") AND json_type("ontology_concepts"."document") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ontology_concepts_release_key` ON `ontology_concepts` (`release_id`,`concept_key`);--> statement-breakpoint
CREATE INDEX `ontology_concepts_key` ON `ontology_concepts` (`concept_key`);--> statement-breakpoint
CREATE TABLE `ontology_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`number` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`imported_at` integer NOT NULL,
	CONSTRAINT "ontology_releases_public_id" CHECK("ontology_releases"."public_id" GLOB 'olr_*'),
	CONSTRAINT "ontology_releases_number" CHECK("ontology_releases"."number" > 0),
	CONSTRAINT "ontology_releases_commit" CHECK(length("ontology_releases"."commit_sha") = 40 AND "ontology_releases"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ontology_releases_digest" CHECK(length("ontology_releases"."digest") = 64),
	CONSTRAINT "ontology_releases_document" CHECK(json_valid("ontology_releases"."document") AND json_type("ontology_releases"."document") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ontology_releases_public_id_unique` ON `ontology_releases` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ontology_releases_number_unique` ON `ontology_releases` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ontology_releases_digest_unique` ON `ontology_releases` (`digest`);--> statement-breakpoint
CREATE TABLE `concept_classifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`release_id` integer NOT NULL,
	`concept_key` text NOT NULL,
	`state` text NOT NULL,
	`evidence` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`release_id`) REFERENCES `ontology_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "concept_classifications_state" CHECK(state IN ('observed', 'inferred', 'unknown', 'not_applicable', 'not_covered')),
	CONSTRAINT "concept_classifications_evidence" CHECK(json_valid("concept_classifications"."evidence") AND json_type("concept_classifications"."evidence") = 'array'),
	CONSTRAINT "concept_classifications_document_digest" CHECK(length("concept_classifications"."document_digest") = 64),
	CONSTRAINT "concept_classifications_projection_version" CHECK("concept_classifications"."projection_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_classifications_profile_concept` ON `concept_classifications` (`profile_id`,`release_id`,`concept_key`);--> statement-breakpoint
CREATE INDEX `concept_classifications_release_concept` ON `concept_classifications` (`release_id`,`concept_key`,`state`);--> statement-breakpoint
CREATE TABLE `dependency_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`manifest` text NOT NULL,
	`package_name` text NOT NULL,
	`field` text,
	`specifier` text,
	`resolved_version` text,
	`state` text NOT NULL,
	`evidence` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dependency_facts_package_name" CHECK(length("dependency_facts"."package_name") > 0),
	CONSTRAINT "dependency_facts_evidence" CHECK(json_valid("dependency_facts"."evidence") AND json_type("dependency_facts"."evidence") = 'array'),
	CONSTRAINT "dependency_facts_document_digest" CHECK(length("dependency_facts"."document_digest") = 64),
	CONSTRAINT "dependency_facts_projection_version" CHECK("dependency_facts"."projection_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `dependency_facts_assessment_package` ON `dependency_facts` (`assessment_id`,`package_name`);--> statement-breakpoint
CREATE INDEX `dependency_facts_package_version` ON `dependency_facts` (`package_name`,`resolved_version`);--> statement-breakpoint
CREATE INDEX `dependency_facts_profile` ON `dependency_facts` (`profile_id`);--> statement-breakpoint
CREATE TABLE `evidence_index` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`evidence_id` text NOT NULL,
	`path` text NOT NULL,
	`location_kind` text NOT NULL,
	`line_start` integer,
	`line_end` integer,
	`pointer` text,
	`pointer_format` text,
	`detector` text NOT NULL,
	`rule` text NOT NULL,
	`content_digest` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_index_location_kind" CHECK(location_kind IN ('lines', 'pointer', 'entry')),
	CONSTRAINT "evidence_index_lines" CHECK(("evidence_index"."location_kind" = 'lines') = ("evidence_index"."line_start" IS NOT NULL AND "evidence_index"."line_end" IS NOT NULL)),
	CONSTRAINT "evidence_index_pointer" CHECK(("evidence_index"."location_kind" = 'pointer') = ("evidence_index"."pointer" IS NOT NULL)),
	CONSTRAINT "evidence_index_document_digest" CHECK(length("evidence_index"."document_digest") = 64),
	CONSTRAINT "evidence_index_projection_version" CHECK("evidence_index"."projection_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_index_profile_evidence` ON `evidence_index` (`profile_id`,`evidence_id`);--> statement-breakpoint
CREATE INDEX `evidence_index_assessment_evidence` ON `evidence_index` (`assessment_id`,`evidence_id`);--> statement-breakpoint
CREATE TABLE `graph_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`map_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`edge_id` text NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`from_node` text NOT NULL,
	`to_node` text,
	`rule` text NOT NULL,
	`basis` text NOT NULL,
	`reason` text,
	`evidence` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`map_id`) REFERENCES `relationship_maps`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "graph_edges_type" CHECK(type IN ('package_dependency', 'package_production', 'composition', 'iframe', 'runtime_contract', 'service_call')),
	CONSTRAINT "graph_edges_state" CHECK(state IN ('resolved', 'ambiguous', 'unresolved', 'out_of_scope')),
	CONSTRAINT "graph_edges_to" CHECK(("graph_edges"."to_node" IS NULL) = ("graph_edges"."state" = 'ambiguous')),
	CONSTRAINT "graph_edges_evidence" CHECK(json_valid("graph_edges"."evidence") AND json_type("graph_edges"."evidence") = 'array'),
	CONSTRAINT "graph_edges_document_digest" CHECK(length("graph_edges"."document_digest") = 64),
	CONSTRAINT "graph_edges_projection_version" CHECK("graph_edges"."projection_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_edges_map_edge` ON `graph_edges` (`map_id`,`edge_id`);--> statement-breakpoint
CREATE INDEX `graph_edges_map_from` ON `graph_edges` (`map_id`,`from_node`);--> statement-breakpoint
CREATE INDEX `graph_edges_map_to` ON `graph_edges` (`map_id`,`to_node`);--> statement-breakpoint
CREATE INDEX `graph_edges_map_type_state` ON `graph_edges` (`map_id`,`type`,`state`);--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`map_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`repository_source_id` integer,
	`assessment_target_id` integer,
	`commit_sha` text,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`map_id`) REFERENCES `relationship_maps`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "graph_nodes_kind" CHECK(kind IN ('repository', 'package', 'external_service', 'out_of_scope_source', 'unresolved_endpoint')),
	CONSTRAINT "graph_nodes_repository_target" CHECK(("graph_nodes"."kind" = 'repository') = ("graph_nodes"."assessment_target_id" IS NOT NULL)),
	CONSTRAINT "graph_nodes_repository_source" CHECK("graph_nodes"."kind" <> 'repository' OR "graph_nodes"."repository_source_id" IS NOT NULL),
	CONSTRAINT "graph_nodes_document_digest" CHECK(length("graph_nodes"."document_digest") = 64),
	CONSTRAINT "graph_nodes_projection_version" CHECK("graph_nodes"."projection_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_nodes_map_node` ON `graph_nodes` (`map_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `graph_nodes_map_kind` ON `graph_nodes` (`map_id`,`kind`);--> statement-breakpoint
CREATE INDEX `graph_nodes_repository_source` ON `graph_nodes` (`repository_source_id`);--> statement-breakpoint
CREATE INDEX `graph_nodes_assessment_target` ON `graph_nodes` (`assessment_target_id`);--> statement-breakpoint
CREATE TABLE `projection_coverage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assessment_id` integer NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projection_coverage_state" CHECK(state IN ('contributed', 'failed', 'canceled')),
	CONSTRAINT "projection_coverage_projection_version" CHECK("projection_coverage"."projection_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_coverage_assessment_target` ON `projection_coverage` (`assessment_id`,`assessment_target_id`);--> statement-breakpoint
CREATE TABLE `projection_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`rebuilding` integer DEFAULT false NOT NULL,
	CONSTRAINT "projection_state_single_row" CHECK("projection_state"."id" = 1),
	CONSTRAINT "projection_state_rebuilding" CHECK("projection_state"."rebuilding" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `lines_of_business` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`label` text NOT NULL,
	`label_key` text NOT NULL,
	`concept_key` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "lines_of_business_public_id" CHECK("lines_of_business"."public_id" GLOB 'lob_*'),
	CONSTRAINT "lines_of_business_label" CHECK(length(trim("lines_of_business"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "lines_of_business_concept" CHECK("lines_of_business"."concept_key" IS NULL OR "lines_of_business"."concept_key" GLOB 'line-of-business/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lines_of_business_public_id_unique` ON `lines_of_business` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lines_of_business_label_key_unique` ON `lines_of_business` (`label_key`);--> statement-breakpoint
CREATE TABLE `ownership_assertions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`attribute` text NOT NULL,
	`operation` text NOT NULL,
	`subject_repository_source_id` integer,
	`subject_application_id` integer,
	`subject_portal_id` integer,
	`value_application_id` integer,
	`value_team` text,
	`value_line_of_business_id` integer,
	`value_portal_id` integer,
	`value_repository_source_id` integer,
	`provided_by` text NOT NULL,
	`attributed_to` text,
	`source` text NOT NULL,
	`verification` text NOT NULL,
	`verified_at` integer,
	`read_at` integer,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`subject_repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_application_id`) REFERENCES `seal_applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_application_id`) REFERENCES `seal_applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_line_of_business_id`) REFERENCES `lines_of_business`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ownership_assertions_public_id" CHECK("ownership_assertions"."public_id" GLOB 'own_*'),
	CONSTRAINT "ownership_assertions_attribute" CHECK(attribute IN ('seal_id', 'team', 'line_of_business', 'portal', 'owner', 'host')),
	CONSTRAINT "ownership_assertions_operation" CHECK(operation IN ('set', 'add', 'remove')),
	CONSTRAINT "ownership_assertions_source" CHECK(source IN ('person', 'de_console', 'bulk_import')),
	CONSTRAINT "ownership_assertions_verification" CHECK(verification IN ('unverified', 'verified', 'not_required')),
	CONSTRAINT "ownership_assertions_shape" CHECK((CASE "ownership_assertions"."attribute"
        WHEN 'seal_id' THEN "ownership_assertions"."subject_repository_source_id" IS NOT NULL AND "ownership_assertions"."subject_application_id" IS NULL AND "ownership_assertions"."subject_portal_id" IS NULL
          AND "ownership_assertions"."operation" = 'set' AND "ownership_assertions"."value_application_id" IS NOT NULL
          AND "ownership_assertions"."value_team" IS NULL AND "ownership_assertions"."value_line_of_business_id" IS NULL AND "ownership_assertions"."value_portal_id" IS NULL AND "ownership_assertions"."value_repository_source_id" IS NULL
        WHEN 'team' THEN "ownership_assertions"."subject_application_id" IS NOT NULL AND "ownership_assertions"."subject_repository_source_id" IS NULL AND "ownership_assertions"."subject_portal_id" IS NULL
          AND "ownership_assertions"."operation" = 'set' AND length(trim("ownership_assertions"."value_team")) BETWEEN 1 AND 200
          AND "ownership_assertions"."value_application_id" IS NULL AND "ownership_assertions"."value_line_of_business_id" IS NULL AND "ownership_assertions"."value_portal_id" IS NULL AND "ownership_assertions"."value_repository_source_id" IS NULL
        WHEN 'line_of_business' THEN "ownership_assertions"."subject_application_id" IS NOT NULL AND "ownership_assertions"."subject_repository_source_id" IS NULL AND "ownership_assertions"."subject_portal_id" IS NULL
          AND "ownership_assertions"."operation" = 'set' AND "ownership_assertions"."value_line_of_business_id" IS NOT NULL
          AND "ownership_assertions"."value_application_id" IS NULL AND "ownership_assertions"."value_team" IS NULL AND "ownership_assertions"."value_portal_id" IS NULL AND "ownership_assertions"."value_repository_source_id" IS NULL
        WHEN 'portal' THEN "ownership_assertions"."subject_application_id" IS NOT NULL AND "ownership_assertions"."subject_repository_source_id" IS NULL AND "ownership_assertions"."subject_portal_id" IS NULL
          AND "ownership_assertions"."operation" IN ('add', 'remove') AND "ownership_assertions"."value_portal_id" IS NOT NULL
          AND "ownership_assertions"."value_application_id" IS NULL AND "ownership_assertions"."value_team" IS NULL AND "ownership_assertions"."value_line_of_business_id" IS NULL AND "ownership_assertions"."value_repository_source_id" IS NULL
        WHEN 'owner' THEN "ownership_assertions"."subject_portal_id" IS NOT NULL AND "ownership_assertions"."subject_repository_source_id" IS NULL AND "ownership_assertions"."subject_application_id" IS NULL
          AND "ownership_assertions"."operation" = 'set' AND "ownership_assertions"."value_application_id" IS NOT NULL
          AND "ownership_assertions"."value_team" IS NULL AND "ownership_assertions"."value_line_of_business_id" IS NULL AND "ownership_assertions"."value_portal_id" IS NULL AND "ownership_assertions"."value_repository_source_id" IS NULL
        WHEN 'host' THEN "ownership_assertions"."subject_portal_id" IS NOT NULL AND "ownership_assertions"."subject_repository_source_id" IS NULL AND "ownership_assertions"."subject_application_id" IS NULL
          AND "ownership_assertions"."operation" = 'set' AND "ownership_assertions"."value_repository_source_id" IS NOT NULL
          AND "ownership_assertions"."value_application_id" IS NULL AND "ownership_assertions"."value_team" IS NULL AND "ownership_assertions"."value_line_of_business_id" IS NULL AND "ownership_assertions"."value_portal_id" IS NULL
        ELSE 0 END)),
	CONSTRAINT "ownership_assertions_provided_by" CHECK(length(trim("ownership_assertions"."provided_by")) BETWEEN 1 AND 200),
	CONSTRAINT "ownership_assertions_attributed_to" CHECK("ownership_assertions"."attributed_to" IS NULL OR length(trim("ownership_assertions"."attributed_to")) BETWEEN 1 AND 200),
	CONSTRAINT "ownership_assertions_trust" CHECK(CASE "ownership_assertions"."source"
        WHEN 'de_console' THEN "ownership_assertions"."verification" = 'not_required' AND "ownership_assertions"."read_at" IS NOT NULL
        ELSE "ownership_assertions"."verification" IN ('unverified', 'verified') AND "ownership_assertions"."read_at" IS NULL END),
	CONSTRAINT "ownership_assertions_verified_at" CHECK(("ownership_assertions"."verification" = 'verified') = ("ownership_assertions"."verified_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ownership_assertions_public_id_unique` ON `ownership_assertions` (`public_id`);--> statement-breakpoint
CREATE INDEX `ownership_assertions_subject_repository` ON `ownership_assertions` (`subject_repository_source_id`,`attribute`);--> statement-breakpoint
CREATE INDEX `ownership_assertions_subject_application` ON `ownership_assertions` (`subject_application_id`,`attribute`);--> statement-breakpoint
CREATE INDEX `ownership_assertions_subject_portal` ON `ownership_assertions` (`subject_portal_id`,`attribute`);--> statement-breakpoint
CREATE INDEX `ownership_assertions_value_application` ON `ownership_assertions` (`value_application_id`);--> statement-breakpoint
CREATE INDEX `ownership_assertions_value_repository` ON `ownership_assertions` (`value_repository_source_id`);--> statement-breakpoint
CREATE TABLE `ownership_supersessions` (
	`assertion_id` integer NOT NULL,
	`superseded_id` integer NOT NULL,
	PRIMARY KEY(`assertion_id`, `superseded_id`),
	FOREIGN KEY (`assertion_id`) REFERENCES `ownership_assertions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`superseded_id`) REFERENCES `ownership_assertions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ownership_supersessions_superseded` ON `ownership_supersessions` (`superseded_id`);--> statement-breakpoint
CREATE TABLE `portals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`label` text NOT NULL,
	`label_key` text NOT NULL,
	`concept_key` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "portals_public_id" CHECK("portals"."public_id" GLOB 'ptl_*'),
	CONSTRAINT "portals_label" CHECK(length(trim("portals"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "portals_concept" CHECK("portals"."concept_key" IS NULL OR "portals"."concept_key" GLOB 'portal/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portals_public_id_unique` ON `portals` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portals_label_key_unique` ON `portals` (`label_key`);--> statement-breakpoint
CREATE TABLE `seal_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`seal_id` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "seal_applications_public_id" CHECK("seal_applications"."public_id" GLOB 'sea_*'),
	CONSTRAINT "seal_applications_seal_id" CHECK(length("seal_applications"."seal_id") BETWEEN 1 AND 64 AND "seal_applications"."seal_id" = trim("seal_applications"."seal_id")),
	CONSTRAINT "seal_applications_name" CHECK("seal_applications"."name" IS NULL OR length(trim("seal_applications"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seal_applications_public_id_unique` ON `seal_applications` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `seal_applications_seal_id_unique` ON `seal_applications` (`seal_id`);