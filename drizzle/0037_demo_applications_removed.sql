-- Visitors' demo deployments go, with their comment threads, comments, and
-- share links: deploying a template is removed (0036). migrateDatabase turns
-- foreign key enforcement off for the run, so the cascades are spelled out.
-- Every thread and share link that's left is on a reference deployment.
DELETE FROM demo_comments WHERE thread_id IN (SELECT id FROM demo_threads WHERE application_id IS NOT NULL);--> statement-breakpoint
DELETE FROM demo_threads WHERE application_id IS NOT NULL;--> statement-breakpoint
DELETE FROM demo_shares WHERE application_id IS NOT NULL;--> statement-breakpoint
DROP TABLE `demo_applications`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_demo_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_digest` text NOT NULL,
	`reference_slug` text NOT NULL,
	`view_workspace_id` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_shares_token_digest" CHECK(length("__new_demo_shares"."token_digest") = 64),
	CONSTRAINT "demo_shares_state" CHECK(json_valid("__new_demo_shares"."state") AND json_type("__new_demo_shares"."state") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_demo_shares`("id", "token_digest", "reference_slug", "view_workspace_id", "state", "created_at") SELECT "id", "token_digest", "reference_slug", "view_workspace_id", "state", "created_at" FROM `demo_shares`;--> statement-breakpoint
DROP TABLE `demo_shares`;--> statement-breakpoint
ALTER TABLE `__new_demo_shares` RENAME TO `demo_shares`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `demo_shares_token_digest_unique` ON `demo_shares` (`token_digest`);--> statement-breakpoint
CREATE INDEX `demo_shares_view_workspace` ON `demo_shares` (`view_workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_demo_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`reference_slug` text NOT NULL,
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
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_threads_public_id" CHECK("__new_demo_threads"."public_id" GLOB 'thr_*'),
	CONSTRAINT "demo_threads_status" CHECK(status IN ('open', 'resolved')),
	CONSTRAINT "demo_threads_offsets" CHECK("__new_demo_threads"."offset_x" BETWEEN 0 AND 1 AND "__new_demo_threads"."offset_y" BETWEEN 0 AND 1),
	CONSTRAINT "demo_threads_resolved" CHECK(("__new_demo_threads"."status" = 'resolved') = ("__new_demo_threads"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_demo_threads`("id", "public_id", "reference_slug", "view_workspace_id", "route", "member", "member_version", "anchor", "offset_x", "offset_y", "status", "created_at", "resolved_at") SELECT "id", "public_id", "reference_slug", "view_workspace_id", "route", "member", "member_version", "anchor", "offset_x", "offset_y", "status", "created_at", "resolved_at" FROM `demo_threads`;--> statement-breakpoint
DROP TABLE `demo_threads`;--> statement-breakpoint
ALTER TABLE `__new_demo_threads` RENAME TO `demo_threads`;--> statement-breakpoint
CREATE UNIQUE INDEX `demo_threads_public_id_unique` ON `demo_threads` (`public_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_reference` ON `demo_threads` (`reference_slug`,`view_workspace_id`);