CREATE TABLE `initiative_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`initiative_id` integer NOT NULL,
	`repository_source_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_targets_selection` ON `initiative_targets` (`initiative_id`,`repository_source_id`);--> statement-breakpoint
CREATE INDEX `initiative_targets_source` ON `initiative_targets` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `initiatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`selection_mode` text DEFAULT 'all_enabled' NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "initiatives_public_id" CHECK("initiatives"."public_id" GLOB 'ini_*'),
	CONSTRAINT "initiatives_name" CHECK(length(trim("initiatives"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "initiatives_objective" CHECK(length("initiatives"."objective") <= 2000),
	CONSTRAINT "initiatives_selection_mode" CHECK(selection_mode IN ('all_enabled', 'explicit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_public_id_unique` ON `initiatives` (`public_id`);--> statement-breakpoint
CREATE TABLE `repository_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`clone_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`git_ref` text,
	`enabled` integer DEFAULT true NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "repository_sources_public_id" CHECK("repository_sources"."public_id" GLOB 'src_*'),
	CONSTRAINT "repository_sources_name" CHECK(length(trim("repository_sources"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "repository_sources_urls" CHECK(length("repository_sources"."clone_url") > 0 AND length("repository_sources"."canonical_url") > 0),
	CONSTRAINT "repository_sources_git_ref" CHECK("repository_sources"."git_ref" IS NULL OR length("repository_sources"."git_ref") BETWEEN 1 AND 255),
	CONSTRAINT "repository_sources_enabled" CHECK("repository_sources"."enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_sources_public_id_unique` ON `repository_sources` (`public_id`);--> statement-breakpoint
CREATE INDEX `repository_sources_canonical_url` ON `repository_sources` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `repository_sources_enabled_canonical_url` ON `repository_sources` (`canonical_url`) WHERE "repository_sources"."enabled" = 1;