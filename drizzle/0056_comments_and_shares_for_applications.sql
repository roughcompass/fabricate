-- Comment threads and share links belong to applications (add-applications,
-- design decision 7). A thread records the application, the route and the
-- commit of the build it was placed on, and the element by its anchor, a CSS
-- path, its tag, and a fingerprint of its text, in place of a template's
-- microfrontend, version, and authored anchor. A share link captures the
-- application, the commit of the build shown, and the route, in place of a
-- template's view state. Deleting an application deletes both.
--
-- Session profiles are gone with the toolbar's Session tool. The threads,
-- comments, share links, and profiles there are were all about templates,
-- which no longer exist, so the tables are dropped and made again, empty.
-- Workspaces stay, with their display names and guidance state.
DROP TABLE `demo_comments`;--> statement-breakpoint
DROP TABLE `demo_profiles`;--> statement-breakpoint
DROP TABLE `demo_shares`;--> statement-breakpoint
DROP TABLE `demo_threads`;--> statement-breakpoint
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
	`application_id` integer NOT NULL,
	`view_workspace_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`route` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_shares_token_digest" CHECK(length("demo_shares"."token_digest") = 64),
	CONSTRAINT "demo_shares_commit_sha" CHECK(length("demo_shares"."commit_sha") = 40 AND "demo_shares"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "demo_shares_route" CHECK("demo_shares"."route" GLOB '/*' AND length("demo_shares"."route") <= 2048)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_shares_token_digest_unique` ON `demo_shares` (`token_digest`);--> statement-breakpoint
CREATE INDEX `demo_shares_view_workspace` ON `demo_shares` (`view_workspace_id`);--> statement-breakpoint
CREATE INDEX `demo_shares_application` ON `demo_shares` (`application_id`);--> statement-breakpoint
CREATE TABLE `demo_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`view_workspace_id` integer NOT NULL,
	`route` text NOT NULL,
	`commit_sha` text NOT NULL,
	`anchor` text NOT NULL,
	`offset_x` real NOT NULL,
	`offset_y` real NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_threads_public_id" CHECK("demo_threads"."public_id" GLOB 'thr_*'),
	CONSTRAINT "demo_threads_status" CHECK(status IN ('open', 'resolved')),
	CONSTRAINT "demo_threads_offsets" CHECK("demo_threads"."offset_x" BETWEEN 0 AND 1 AND "demo_threads"."offset_y" BETWEEN 0 AND 1),
	CONSTRAINT "demo_threads_resolved" CHECK(("demo_threads"."status" = 'resolved') = ("demo_threads"."resolved_at" IS NOT NULL)),
	CONSTRAINT "demo_threads_route" CHECK("demo_threads"."route" GLOB '/*' AND length("demo_threads"."route") <= 2048),
	CONSTRAINT "demo_threads_commit_sha" CHECK(length("demo_threads"."commit_sha") = 40 AND "demo_threads"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "demo_threads_anchor" CHECK(json_valid("demo_threads"."anchor") AND json_type("demo_threads"."anchor") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_threads_public_id_unique` ON `demo_threads` (`public_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_view` ON `demo_threads` (`application_id`,`view_workspace_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_workspace` ON `demo_threads` (`view_workspace_id`,`status`);
