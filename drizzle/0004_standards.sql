CREATE TABLE `initiative_standard_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`initiative_id` integer NOT NULL,
	`standard_release_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`standard_release_id`) REFERENCES `standard_releases`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_standard_releases_selection` ON `initiative_standard_releases` (`initiative_id`,`standard_release_id`);--> statement-breakpoint
CREATE INDEX `initiative_standard_releases_release` ON `initiative_standard_releases` (`standard_release_id`);--> statement-breakpoint
CREATE TABLE `standard_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`standard_id` integer NOT NULL,
	`based_on_release_id` integer,
	`document` text NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`standard_id`) REFERENCES `standards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`based_on_release_id`) REFERENCES `standard_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "standard_drafts_document" CHECK(json_valid("standard_drafts"."document") AND json_type("standard_drafts"."document") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standard_drafts_standard_id_unique` ON `standard_drafts` (`standard_id`);--> statement-breakpoint
CREATE TABLE `standard_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`standard_id` integer NOT NULL,
	`version` integer NOT NULL,
	`document_schema_version` integer NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`profile_schema_versions` text NOT NULL,
	`relationship_schema_versions` text NOT NULL,
	`draft_lock_version` integer NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`standard_id`) REFERENCES `standards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "standard_releases_public_id" CHECK("standard_releases"."public_id" GLOB 'rel_*'),
	CONSTRAINT "standard_releases_version_positive" CHECK("standard_releases"."version" > 0),
	CONSTRAINT "standard_releases_digest" CHECK(length("standard_releases"."digest") = 64),
	CONSTRAINT "standard_releases_document" CHECK(json_valid("standard_releases"."document") AND json_type("standard_releases"."document") = 'object'),
	CONSTRAINT "standard_releases_schema_versions" CHECK(json_valid("standard_releases"."profile_schema_versions") AND json_type("standard_releases"."profile_schema_versions") = 'array' AND json_valid("standard_releases"."relationship_schema_versions") AND json_type("standard_releases"."relationship_schema_versions") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standard_releases_public_id_unique` ON `standard_releases` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `standard_releases_version` ON `standard_releases` (`standard_id`,`version`);--> statement-breakpoint
CREATE TABLE `standards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "standards_public_id" CHECK("standards"."public_id" GLOB 'std_*'),
	CONSTRAINT "standards_name_length" CHECK(length(trim("standards"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "standards_purpose_length" CHECK(length(trim("standards"."purpose")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standards_public_id_unique` ON `standards` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `standards_name` ON `standards` (lower("name"));