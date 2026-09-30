CREATE TABLE `evaluation_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`evaluation_id` integer NOT NULL,
	`standard_release_id` integer NOT NULL,
	`release_digest` text NOT NULL,
	`position` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_reason` text,
	`started_at` integer,
	`finished_at` integer,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`standard_release_id`) REFERENCES `standard_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluation_releases_state" CHECK(state IN ('pending', 'evaluating', 'complete', 'failed')),
	CONSTRAINT "evaluation_releases_digest" CHECK(length("evaluation_releases"."release_digest") = 64),
	CONSTRAINT "evaluation_releases_position_range" CHECK("evaluation_releases"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_releases_release` ON `evaluation_releases` (`evaluation_id`,`standard_release_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_releases_position` ON `evaluation_releases` (`evaluation_id`,`position`);--> statement-breakpoint
CREATE INDEX `evaluation_releases_standard_release` ON `evaluation_releases` (`standard_release_id`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`initiative_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`launch_token` text NOT NULL,
	`evaluator_version` text NOT NULL,
	`configuration` text NOT NULL,
	`configuration_digest` text NOT NULL,
	`profile_schema_version` integer NOT NULL,
	`relationship_schema_version` integer NOT NULL,
	`coverage_gaps` text NOT NULL,
	`summary` text,
	`result_digest` text,
	`failure_reason` text,
	`started_at` integer,
	`finished_at` integer,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluations_public_id" CHECK("evaluations"."public_id" GLOB 'evl_*'),
	CONSTRAINT "evaluations_state" CHECK(state IN ('queued', 'evaluating', 'finalizing', 'complete', 'failed')),
	CONSTRAINT "evaluations_configuration_digest" CHECK(length("evaluations"."configuration_digest") = 64),
	CONSTRAINT "evaluations_coverage_gaps" CHECK(json_valid("evaluations"."coverage_gaps") AND json_type("evaluations"."coverage_gaps") = 'array'),
	CONSTRAINT "evaluations_complete_result" CHECK("evaluations"."state" <> 'complete' OR ("evaluations"."summary" IS NOT NULL AND length("evaluations"."result_digest") = 64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluations_public_id_unique` ON `evaluations` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `evaluations_launch_token_unique` ON `evaluations` (`launch_token`);--> statement-breakpoint
CREATE INDEX `evaluations_initiative` ON `evaluations` (`initiative_id`);--> statement-breakpoint
CREATE INDEX `evaluations_assessment` ON `evaluations` (`assessment_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`evaluation_id` integer NOT NULL,
	`evaluation_release_id` integer NOT NULL,
	`standard_release_id` integer NOT NULL,
	`assessment_target_id` integer,
	`control_key` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_key` text NOT NULL,
	`outcome` text NOT NULL,
	`severity` text NOT NULL,
	`position` integer NOT NULL,
	`document_schema_version` integer NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evaluation_release_id`) REFERENCES `evaluation_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`standard_release_id`) REFERENCES `standard_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "findings_public_id" CHECK("findings"."public_id" GLOB 'fnd_*'),
	CONSTRAINT "findings_outcome" CHECK(outcome IN ('meets', 'gap', 'indeterminate', 'not_applicable')),
	CONSTRAINT "findings_severity_value" CHECK(severity IN ('info', 'low', 'medium', 'high', 'critical')),
	CONSTRAINT "findings_subject_type" CHECK(subject_type IN ('repository', 'relationship_map')),
	CONSTRAINT "findings_subject_target" CHECK(("findings"."subject_type" = 'repository') = ("findings"."assessment_target_id" IS NOT NULL)),
	CONSTRAINT "findings_digest" CHECK(length("findings"."digest") = 64),
	CONSTRAINT "findings_document" CHECK(json_valid("findings"."document") AND json_type("findings"."document") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_public_id_unique` ON `findings` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_control_subject` ON `findings` (`evaluation_release_id`,`control_key`,`subject_key`);--> statement-breakpoint
CREATE INDEX `findings_evaluation_outcome` ON `findings` (`evaluation_id`,`outcome`);--> statement-breakpoint
CREATE INDEX `findings_evaluation_release` ON `findings` (`evaluation_release_id`,`position`);--> statement-breakpoint
CREATE INDEX `findings_standard_release` ON `findings` (`standard_release_id`);--> statement-breakpoint
CREATE INDEX `findings_control` ON `findings` (`control_key`);--> statement-breakpoint
CREATE INDEX `findings_subject` ON `findings` (`subject_key`);--> statement-breakpoint
CREATE INDEX `findings_severity` ON `findings` (`severity`);--> statement-breakpoint
CREATE INDEX `findings_assessment_target` ON `findings` (`assessment_target_id`);