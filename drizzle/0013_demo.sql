CREATE TABLE `demo_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`workspace_id` integer NOT NULL,
	`template_slug` text NOT NULL,
	`name` text NOT NULL,
	`environment` text NOT NULL,
	`bitbucket_project` text,
	`bitbucket_repository` text,
	`created_at` integer NOT NULL,
	`build_skipped_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_applications_public_id" CHECK("demo_applications"."public_id" GLOB 'app_*'),
	CONSTRAINT "demo_applications_name" CHECK(length(trim("demo_applications"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "demo_applications_environment" CHECK(environment IN ('sandbox', 'dev')),
	CONSTRAINT "demo_applications_bitbucket" CHECK(("demo_applications"."environment" = 'dev' AND "demo_applications"."bitbucket_project" IS NOT NULL AND "demo_applications"."bitbucket_repository" IS NOT NULL) OR ("demo_applications"."environment" = 'sandbox' AND "demo_applications"."bitbucket_project" IS NULL AND "demo_applications"."bitbucket_repository" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_applications_public_id_unique` ON `demo_applications` (`public_id`);--> statement-breakpoint
CREATE INDEX `demo_applications_workspace` ON `demo_applications` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `demo_applications_repository` ON `demo_applications` (`workspace_id`,`bitbucket_project`,`bitbucket_repository`) WHERE "demo_applications"."environment" = 'dev';--> statement-breakpoint
CREATE TABLE `demo_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`thread_id` integer NOT NULL,
	`author_workspace_id` integer,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `demo_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "demo_comments_public_id" CHECK("demo_comments"."public_id" GLOB 'cmt_*'),
	CONSTRAINT "demo_comments_author_name" CHECK(length(trim("demo_comments"."author_name")) BETWEEN 1 AND 60),
	CONSTRAINT "demo_comments_body" CHECK(length(trim("demo_comments"."body")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_comments_public_id_unique` ON `demo_comments` (`public_id`);--> statement-breakpoint
CREATE INDEX `demo_comments_thread` ON `demo_comments` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `demo_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_digest` text NOT NULL,
	`application_id` integer,
	`reference_slug` text,
	`view_workspace_id` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `demo_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_shares_token_digest" CHECK(length("demo_shares"."token_digest") = 64),
	CONSTRAINT "demo_shares_target" CHECK(("demo_shares"."application_id" IS NULL) <> ("demo_shares"."reference_slug" IS NULL)),
	CONSTRAINT "demo_shares_state" CHECK(json_valid("demo_shares"."state") AND json_type("demo_shares"."state") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_shares_token_digest_unique` ON `demo_shares` (`token_digest`);--> statement-breakpoint
CREATE INDEX `demo_shares_application` ON `demo_shares` (`application_id`);--> statement-breakpoint
CREATE INDEX `demo_shares_view_workspace` ON `demo_shares` (`view_workspace_id`);--> statement-breakpoint
CREATE TABLE `demo_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer,
	`reference_slug` text,
	`view_workspace_id` integer NOT NULL,
	`route` text NOT NULL,
	`member` text NOT NULL,
	`member_version` text NOT NULL,
	`anchor` text NOT NULL,
	`offset_x` real NOT NULL,
	`offset_y` real NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `demo_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_threads_public_id" CHECK("demo_threads"."public_id" GLOB 'thr_*'),
	CONSTRAINT "demo_threads_target" CHECK(("demo_threads"."application_id" IS NULL) <> ("demo_threads"."reference_slug" IS NULL)),
	CONSTRAINT "demo_threads_status" CHECK(status IN ('open', 'resolved')),
	CONSTRAINT "demo_threads_offsets" CHECK("demo_threads"."offset_x" BETWEEN 0 AND 1 AND "demo_threads"."offset_y" BETWEEN 0 AND 1),
	CONSTRAINT "demo_threads_resolved" CHECK(("demo_threads"."status" = 'resolved') = ("demo_threads"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_threads_public_id_unique` ON `demo_threads` (`public_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_application` ON `demo_threads` (`application_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_reference` ON `demo_threads` (`reference_slug`,`view_workspace_id`);--> statement-breakpoint
CREATE TABLE `demo_workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key_digest` text NOT NULL,
	`display_name` text,
	`hints` text DEFAULT '{}' NOT NULL,
	`reset_epoch` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT "demo_workspaces_key_digest" CHECK(length("demo_workspaces"."key_digest") = 64),
	CONSTRAINT "demo_workspaces_display_name" CHECK("demo_workspaces"."display_name" IS NULL OR length(trim("demo_workspaces"."display_name")) BETWEEN 1 AND 60),
	CONSTRAINT "demo_workspaces_hints" CHECK(json_valid("demo_workspaces"."hints") AND json_type("demo_workspaces"."hints") = 'object'),
	CONSTRAINT "demo_workspaces_reset_epoch" CHECK("demo_workspaces"."reset_epoch" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_workspaces_key_digest_unique` ON `demo_workspaces` (`key_digest`);--> statement-breakpoint
CREATE INDEX `demo_workspaces_last_seen` ON `demo_workspaces` (`last_seen_at`);