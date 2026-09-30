CREATE TABLE `assessment_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_id` integer NOT NULL,
	`repository_source_id` integer NOT NULL,
	`position` integer NOT NULL,
	`source_public_id` text NOT NULL,
	`source_name` text NOT NULL,
	`clone_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`git_ref` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`started_at` integer,
	`finished_at` integer,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assessment_targets_public_id" CHECK("assessment_targets"."public_id" GLOB 'tgt_*'),
	CONSTRAINT "assessment_targets_position_range" CHECK("assessment_targets"."position" >= 0),
	CONSTRAINT "assessment_targets_state" CHECK(state IN ('pending', 'acquiring', 'analyzing', 'complete', 'failed', 'canceled')),
	CONSTRAINT "assessment_targets_failure_code" CHECK(("assessment_targets"."failure_code" IS NOT NULL) = ("assessment_targets"."state" = 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_public_id_unique` ON `assessment_targets` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_position` ON `assessment_targets` (`assessment_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_source` ON `assessment_targets` (`assessment_id`,`repository_source_id`);--> statement-breakpoint
CREATE INDEX `assessment_targets_repository_source` ON `assessment_targets` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`initiative_id` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`launch_token` text NOT NULL,
	`detector_release` text NOT NULL,
	`configuration` text NOT NULL,
	`configuration_digest` text NOT NULL,
	`profile_schema_version` integer NOT NULL,
	`relationship_schema_version` integer NOT NULL,
	`cancel_requested_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`failure_reason` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assessments_public_id" CHECK("assessments"."public_id" GLOB 'asm_*'),
	CONSTRAINT "assessments_state" CHECK(state IN ('queued', 'acquiring', 'analyzing', 'finalizing', 'complete', 'complete_with_issues', 'failed', 'canceled')),
	CONSTRAINT "assessments_configuration_digest" CHECK(length("assessments"."configuration_digest") = 64),
	CONSTRAINT "assessments_schema_versions" CHECK("assessments"."profile_schema_version" > 0 AND "assessments"."relationship_schema_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_public_id_unique` ON `assessments` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_launch_token_unique` ON `assessments` (`launch_token`);--> statement-breakpoint
CREATE INDEX `assessments_initiative` ON `assessments` (`initiative_id`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`repository_source_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`tree_sha` text NOT NULL,
	`ref_kind` text NOT NULL,
	`resolved_ref` text NOT NULL,
	`internal_ref` text NOT NULL,
	`acquisition_metadata` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "source_snapshots_public_id" CHECK("source_snapshots"."public_id" GLOB 'snp_*'),
	CONSTRAINT "source_snapshots_object_ids" CHECK(length("source_snapshots"."commit_sha") = 40 AND "source_snapshots"."commit_sha" NOT GLOB '*[^0-9a-f]*' AND length("source_snapshots"."tree_sha") = 40 AND "source_snapshots"."tree_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "source_snapshots_ref_kind" CHECK(ref_kind IN ('default_branch', 'branch', 'tag', 'commit')),
	CONSTRAINT "source_snapshots_internal_ref" CHECK("source_snapshots"."internal_ref" = 'refs/fabricate/snapshots/' || "source_snapshots"."public_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_public_id_unique` ON `source_snapshots` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_assessment_target_id_unique` ON `source_snapshots` (`assessment_target_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_internal_ref_unique` ON `source_snapshots` (`internal_ref`);--> statement-breakpoint
CREATE INDEX `source_snapshots_commit` ON `source_snapshots` (`commit_sha`);--> statement-breakpoint
CREATE INDEX `source_snapshots_repository_source` ON `source_snapshots` (`repository_source_id`);