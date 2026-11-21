-- Mock sets (add-mock-sets, design decisions 9 to 11, and the migration
-- plan).
--
-- `mock_sets` are an application's named sets of rules that answer its
-- builds' API calls in previews and screenshots, shared by every workspace.
-- `mock_rules` are their rules, in the set's order, each with up to 20
-- responses. Neither holds a body: bodies are content-addressed files under
-- `previews.storage/.mock-sets/`. Deleting an application deletes its sets,
-- and deleting a set deletes its rules.
--
-- `mock_set_defaults` holds an application's default set, and each saved
-- preview's own choice: a set, or None with no set; a saved preview with no
-- row inherits the application's. `mock_set_choices` holds each workspace's
-- choice for each view, the tracked branch or one saved preview; no set means
-- None. Each is unique on its application, workspace, and ifnull(preview, 0),
-- as two partial indexes. Deleting a set, a workspace, a saved preview, or an
-- application deletes the rows that name it.
--
-- `mock_set_imports` are HAR uploads' drafts between upload and review, whose
-- sanitized calls sit under `previews.storage/.mock-imports/`.
--
-- `screenshot_failed_calls` keeps up to 50 API calls that failed when a build
-- was captured. `preview_screenshots` gains plain columns for the mock set it
-- was captured with, how many calls failed, and when the alert was dismissed.
-- Adding plain columns rebuilds no table, and no existing table is rebuilt.
-- Existing screenshots have no set and no failed calls. `demo_shares.view`
-- gains a `mocks` member, which is JSON, so its schema doesn't change.
CREATE TABLE `mock_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`set_id` integer NOT NULL,
	`position` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`method` text NOT NULL,
	`origin` text,
	`pattern` text NOT NULL,
	`query_mode` text DEFAULT 'ignore_all' NOT NULL,
	`query` text DEFAULT '[]' NOT NULL,
	`query_ignored` text DEFAULT '[]' NOT NULL,
	`body_mode` text DEFAULT 'ignore' NOT NULL,
	`body_digest` text,
	`body_size` integer,
	`body_type` text,
	`responses` text DEFAULT '[]' NOT NULL,
	`created_by_name` text,
	`updated_by_name` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `mock_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mock_rules_public_id" CHECK("mock_rules"."public_id" GLOB 'mkr_*'),
	CONSTRAINT "mock_rules_position" CHECK("mock_rules"."position" >= 0),
	CONSTRAINT "mock_rules_method" CHECK("mock_rules"."method" = '*' OR (length("mock_rules"."method") BETWEEN 1 AND 20 AND "mock_rules"."method" NOT GLOB '*[^A-Z]*')),
	CONSTRAINT "mock_rules_origin" CHECK("mock_rules"."origin" IS NULL OR length("mock_rules"."origin") BETWEEN 1 AND 255),
	CONSTRAINT "mock_rules_pattern" CHECK("mock_rules"."pattern" GLOB '/*' AND length("mock_rules"."pattern") <= 2048),
	CONSTRAINT "mock_rules_query_mode" CHECK(query_mode IN ('exact', 'ignore_listed', 'ignore_all')),
	CONSTRAINT "mock_rules_query" CHECK(json_valid("mock_rules"."query") AND json_type("mock_rules"."query") = 'array' AND json_array_length("mock_rules"."query") <= 200 AND json_valid("mock_rules"."query_ignored") AND json_type("mock_rules"."query_ignored") = 'array' AND json_array_length("mock_rules"."query_ignored") <= 200),
	CONSTRAINT "mock_rules_body_mode" CHECK(body_mode IN ('ignore', 'exact', 'json')),
	CONSTRAINT "mock_rules_body" CHECK(("mock_rules"."body_mode" = 'ignore') = ("mock_rules"."body_digest" IS NULL) AND ("mock_rules"."body_digest" IS NULL) = ("mock_rules"."body_size" IS NULL) AND ("mock_rules"."body_size" IS NULL OR "mock_rules"."body_size" BETWEEN 0 AND 65536)),
	CONSTRAINT "mock_rules_body_digest" CHECK("mock_rules"."body_digest" IS NULL OR (length("mock_rules"."body_digest") = 64 AND "mock_rules"."body_digest" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "mock_rules_responses" CHECK(json_valid("mock_rules"."responses") AND json_type("mock_rules"."responses") = 'array' AND json_array_length("mock_rules"."responses") <= 20),
	CONSTRAINT "mock_rules_enabled" CHECK(NOT "mock_rules"."enabled" OR json_array_length("mock_rules"."responses") >= 1),
	CONSTRAINT "mock_rules_statuses" CHECK((json_type("mock_rules"."responses", '$[0]') IS NULL OR (json_type("mock_rules"."responses", '$[0].status') = 'integer' AND json_extract("mock_rules"."responses", '$[0].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[1]') IS NULL OR (json_type("mock_rules"."responses", '$[1].status') = 'integer' AND json_extract("mock_rules"."responses", '$[1].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[2]') IS NULL OR (json_type("mock_rules"."responses", '$[2].status') = 'integer' AND json_extract("mock_rules"."responses", '$[2].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[3]') IS NULL OR (json_type("mock_rules"."responses", '$[3].status') = 'integer' AND json_extract("mock_rules"."responses", '$[3].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[4]') IS NULL OR (json_type("mock_rules"."responses", '$[4].status') = 'integer' AND json_extract("mock_rules"."responses", '$[4].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[5]') IS NULL OR (json_type("mock_rules"."responses", '$[5].status') = 'integer' AND json_extract("mock_rules"."responses", '$[5].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[6]') IS NULL OR (json_type("mock_rules"."responses", '$[6].status') = 'integer' AND json_extract("mock_rules"."responses", '$[6].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[7]') IS NULL OR (json_type("mock_rules"."responses", '$[7].status') = 'integer' AND json_extract("mock_rules"."responses", '$[7].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[8]') IS NULL OR (json_type("mock_rules"."responses", '$[8].status') = 'integer' AND json_extract("mock_rules"."responses", '$[8].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[9]') IS NULL OR (json_type("mock_rules"."responses", '$[9].status') = 'integer' AND json_extract("mock_rules"."responses", '$[9].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[10]') IS NULL OR (json_type("mock_rules"."responses", '$[10].status') = 'integer' AND json_extract("mock_rules"."responses", '$[10].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[11]') IS NULL OR (json_type("mock_rules"."responses", '$[11].status') = 'integer' AND json_extract("mock_rules"."responses", '$[11].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[12]') IS NULL OR (json_type("mock_rules"."responses", '$[12].status') = 'integer' AND json_extract("mock_rules"."responses", '$[12].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[13]') IS NULL OR (json_type("mock_rules"."responses", '$[13].status') = 'integer' AND json_extract("mock_rules"."responses", '$[13].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[14]') IS NULL OR (json_type("mock_rules"."responses", '$[14].status') = 'integer' AND json_extract("mock_rules"."responses", '$[14].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[15]') IS NULL OR (json_type("mock_rules"."responses", '$[15].status') = 'integer' AND json_extract("mock_rules"."responses", '$[15].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[16]') IS NULL OR (json_type("mock_rules"."responses", '$[16].status') = 'integer' AND json_extract("mock_rules"."responses", '$[16].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[17]') IS NULL OR (json_type("mock_rules"."responses", '$[17].status') = 'integer' AND json_extract("mock_rules"."responses", '$[17].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[18]') IS NULL OR (json_type("mock_rules"."responses", '$[18].status') = 'integer' AND json_extract("mock_rules"."responses", '$[18].status') BETWEEN 200 AND 599)) AND (json_type("mock_rules"."responses", '$[19]') IS NULL OR (json_type("mock_rules"."responses", '$[19].status') = 'integer' AND json_extract("mock_rules"."responses", '$[19].status') BETWEEN 200 AND 599))),
	CONSTRAINT "mock_rules_created_by_name" CHECK("mock_rules"."created_by_name" IS NULL OR length(trim("mock_rules"."created_by_name")) BETWEEN 1 AND 60),
	CONSTRAINT "mock_rules_updated_by_name" CHECK("mock_rules"."updated_by_name" IS NULL OR length(trim("mock_rules"."updated_by_name")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mock_rules_public_id_unique` ON `mock_rules` (`public_id`);--> statement-breakpoint
CREATE INDEX `mock_rules_set_position` ON `mock_rules` (`set_id`,`position`);--> statement-breakpoint
CREATE TABLE `mock_set_choices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`application_id` integer NOT NULL,
	`application_preview_id` integer,
	`mock_set_id` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_preview_id`) REFERENCES `application_previews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mock_set_id`) REFERENCES `mock_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mock_set_choices_application_view` ON `mock_set_choices` (`workspace_id`,`application_id`) WHERE "mock_set_choices"."application_preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mock_set_choices_preview_view` ON `mock_set_choices` (`workspace_id`,`application_preview_id`) WHERE "mock_set_choices"."application_preview_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `mock_set_choices_application` ON `mock_set_choices` (`application_id`);--> statement-breakpoint
CREATE INDEX `mock_set_choices_preview` ON `mock_set_choices` (`application_preview_id`);--> statement-breakpoint
CREATE INDEX `mock_set_choices_set` ON `mock_set_choices` (`mock_set_id`);--> statement-breakpoint
CREATE TABLE `mock_set_defaults` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`application_preview_id` integer,
	`mock_set_id` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_preview_id`) REFERENCES `application_previews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mock_set_id`) REFERENCES `mock_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mock_set_defaults_application" CHECK("mock_set_defaults"."application_preview_id" IS NOT NULL OR "mock_set_defaults"."mock_set_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mock_set_defaults_application_row` ON `mock_set_defaults` (`application_id`) WHERE "mock_set_defaults"."application_preview_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mock_set_defaults_preview_row` ON `mock_set_defaults` (`application_preview_id`) WHERE "mock_set_defaults"."application_preview_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `mock_set_defaults_set` ON `mock_set_defaults` (`mock_set_id`);--> statement-breakpoint
CREATE TABLE `mock_set_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`target_set_id` integer,
	`file_name` text NOT NULL,
	`entry_count` integer NOT NULL,
	`set_name` text,
	`unchecked` text DEFAULT '[]' NOT NULL,
	`hosts` text,
	`make_default` integer,
	`from_onboarding` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_set_id`) REFERENCES `mock_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mock_set_imports_public_id" CHECK("mock_set_imports"."public_id" GLOB 'mki_*'),
	CONSTRAINT "mock_set_imports_file_name" CHECK(length("mock_set_imports"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "mock_set_imports_entry_count" CHECK("mock_set_imports"."entry_count" BETWEEN 0 AND 5000),
	CONSTRAINT "mock_set_imports_set_name" CHECK("mock_set_imports"."set_name" IS NULL OR length(trim("mock_set_imports"."set_name")) BETWEEN 1 AND 60),
	CONSTRAINT "mock_set_imports_unchecked" CHECK(json_valid("mock_set_imports"."unchecked") AND json_type("mock_set_imports"."unchecked") = 'array'),
	CONSTRAINT "mock_set_imports_hosts" CHECK("mock_set_imports"."hosts" IS NULL OR (json_valid("mock_set_imports"."hosts") AND json_type("mock_set_imports"."hosts") = 'object')),
	CONSTRAINT "mock_set_imports_expiry" CHECK("mock_set_imports"."expires_at" > "mock_set_imports"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mock_set_imports_public_id_unique` ON `mock_set_imports` (`public_id`);--> statement-breakpoint
CREATE INDEX `mock_set_imports_application` ON `mock_set_imports` (`application_id`);--> statement-breakpoint
CREATE INDEX `mock_set_imports_workspace` ON `mock_set_imports` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `mock_set_imports_expires` ON `mock_set_imports` (`expires_at`);--> statement-breakpoint
CREATE INDEX `mock_set_imports_target` ON `mock_set_imports` (`target_set_id`);--> statement-breakpoint
CREATE TABLE `mock_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`source_file` text,
	`host_mode` text DEFAULT 'any' NOT NULL,
	`hosts` text DEFAULT '[]' NOT NULL,
	`unmatched` text DEFAULT 'pass' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`rule_count` integer DEFAULT 0 NOT NULL,
	`body_bytes` integer DEFAULT 0 NOT NULL,
	`created_by_name` text,
	`updated_by_name` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mock_sets_public_id" CHECK("mock_sets"."public_id" GLOB 'mks_*'),
	CONSTRAINT "mock_sets_name" CHECK(length(trim("mock_sets"."name")) BETWEEN 1 AND 60 AND length("mock_sets"."name_key") > 0),
	CONSTRAINT "mock_sets_description" CHECK("mock_sets"."description" IS NULL OR length("mock_sets"."description") <= 280),
	CONSTRAINT "mock_sets_source" CHECK(source IN ('har', 'written', 'calls')),
	CONSTRAINT "mock_sets_source_file" CHECK("mock_sets"."source_file" IS NULL OR length("mock_sets"."source_file") BETWEEN 1 AND 255),
	CONSTRAINT "mock_sets_host_mode" CHECK(host_mode IN ('any', 'mapped')),
	CONSTRAINT "mock_sets_hosts" CHECK(json_valid("mock_sets"."hosts") AND json_type("mock_sets"."hosts") = 'array' AND json_array_length("mock_sets"."hosts") <= 20),
	CONSTRAINT "mock_sets_unmatched" CHECK(unmatched IN ('pass', 'not_mocked')),
	CONSTRAINT "mock_sets_counts" CHECK("mock_sets"."revision" >= 1 AND "mock_sets"."rule_count" BETWEEN 0 AND 500 AND "mock_sets"."body_bytes" >= 0),
	CONSTRAINT "mock_sets_created_by_name" CHECK("mock_sets"."created_by_name" IS NULL OR length(trim("mock_sets"."created_by_name")) BETWEEN 1 AND 60),
	CONSTRAINT "mock_sets_updated_by_name" CHECK("mock_sets"."updated_by_name" IS NULL OR length(trim("mock_sets"."updated_by_name")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mock_sets_public_id_unique` ON `mock_sets` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mock_sets_name_key` ON `mock_sets` (`application_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `screenshot_failed_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`screenshot_id` integer NOT NULL,
	`position` integer NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`status` integer,
	`error` text,
	`occurrences` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`screenshot_id`) REFERENCES `preview_screenshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "screenshot_failed_calls_position" CHECK("screenshot_failed_calls"."position" BETWEEN 0 AND 49),
	CONSTRAINT "screenshot_failed_calls_method" CHECK(length("screenshot_failed_calls"."method") BETWEEN 1 AND 20),
	CONSTRAINT "screenshot_failed_calls_url" CHECK(length("screenshot_failed_calls"."url") BETWEEN 1 AND 2048),
	CONSTRAINT "screenshot_failed_calls_kind" CHECK(kind IN ('status', 'connect', 'cors', 'not_mocked', 'websocket')),
	CONSTRAINT "screenshot_failed_calls_status" CHECK(("screenshot_failed_calls"."kind" IN ('status', 'not_mocked')) = ("screenshot_failed_calls"."status" IS NOT NULL) AND ("screenshot_failed_calls"."status" IS NULL OR "screenshot_failed_calls"."status" BETWEEN 100 AND 599)),
	CONSTRAINT "screenshot_failed_calls_error" CHECK("screenshot_failed_calls"."error" IS NULL OR length("screenshot_failed_calls"."error") <= 200),
	CONSTRAINT "screenshot_failed_calls_occurrences" CHECK("screenshot_failed_calls"."occurrences" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screenshot_failed_calls_position` ON `screenshot_failed_calls` (`screenshot_id`,`position`);--> statement-breakpoint
ALTER TABLE `preview_screenshots` ADD `mock_set_public_id` text;--> statement-breakpoint
ALTER TABLE `preview_screenshots` ADD `mock_set_name` text;--> statement-breakpoint
ALTER TABLE `preview_screenshots` ADD `mock_set_revision` integer;--> statement-breakpoint
ALTER TABLE `preview_screenshots` ADD `failed_calls` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `preview_screenshots` ADD `failures_dismissed_at` integer;