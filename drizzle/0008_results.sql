CREATE TABLE `relationship_maps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_id` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`resolver_version` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "relationship_maps_public_id" CHECK("relationship_maps"."public_id" GLOB 'map_*'),
	CONSTRAINT "relationship_maps_digest" CHECK(length("relationship_maps"."digest") = 64),
	CONSTRAINT "relationship_maps_document" CHECK(json_valid("relationship_maps"."document") AND json_type("relationship_maps"."document") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationship_maps_public_id_unique` ON `relationship_maps` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `relationship_maps_assessment_id_unique` ON `relationship_maps` (`assessment_id`);--> statement-breakpoint
CREATE TABLE `repository_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_id` integer NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`source_snapshot_id` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`detector_release` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `source_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "repository_profiles_public_id" CHECK("repository_profiles"."public_id" GLOB 'prf_*'),
	CONSTRAINT "repository_profiles_digest" CHECK(length("repository_profiles"."digest") = 64),
	CONSTRAINT "repository_profiles_document" CHECK(json_valid("repository_profiles"."document") AND json_type("repository_profiles"."document") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_profiles_public_id_unique` ON `repository_profiles` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repository_profiles_assessment_target_id_unique` ON `repository_profiles` (`assessment_target_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repository_profiles_source_snapshot_id_unique` ON `repository_profiles` (`source_snapshot_id`);--> statement-breakpoint
CREATE INDEX `repository_profiles_assessment` ON `repository_profiles` (`assessment_id`);