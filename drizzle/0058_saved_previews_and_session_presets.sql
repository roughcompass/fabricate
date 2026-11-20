-- Saved previews, session presets, and shares and threads that record the
-- preview (restore-toolbar-tools-and-branch-previews, design decisions 1, 5,
-- and 8, and the migration plan).
--
-- `application_previews` holds an application's saved branch and tag
-- previews. Like `applications`, each row points at the repository previews
-- that are its current build and its latest attempt. Its key names it in
-- `/run/<slug>@<key>`, so it never holds `@` or `/`, and it never changes.
--
-- `session_presets` are named storage, cookie, and query presets that belong
-- to an application, shared by every workspace. `session_preset_choices`
-- holds which preset each workspace starts each application with. Deleting a
-- preset, a workspace, or an application deletes the choices that name it.
--
-- `demo_shares` gains the saved preview shown, its ref as it was then, and a
-- view object (theme, routing, and the chosen preset's ID and name).
-- `demo_threads` gains the saved preview and its ref. Adding their checks
-- rebuilds both tables. No triggers read them, and `demo_comments` keeps its
-- reference to `demo_threads` by name. Existing rows keep their values: they
-- were placed on tracked branches, so their preview and ref stay null, and a
-- share's view starts empty. No data moves anywhere else.
CREATE TABLE `session_preset_choices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`application_id` integer NOT NULL,
	`preset_id` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preset_id`) REFERENCES `session_presets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_preset_choices_workspace_application` ON `session_preset_choices` (`workspace_id`,`application_id`);--> statement-breakpoint
CREATE INDEX `session_preset_choices_application` ON `session_preset_choices` (`application_id`);--> statement-breakpoint
CREATE INDEX `session_preset_choices_preset` ON `session_preset_choices` (`preset_id`);--> statement-breakpoint
CREATE TABLE `session_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`entries` text NOT NULL,
	`updated_by_name` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_presets_public_id" CHECK("session_presets"."public_id" GLOB 'ses_*'),
	CONSTRAINT "session_presets_name" CHECK(length(trim("session_presets"."name")) BETWEEN 1 AND 60 AND length("session_presets"."name_key") > 0),
	CONSTRAINT "session_presets_entries" CHECK(json_valid("session_presets"."entries") AND json_type("session_presets"."entries") = 'array' AND json_array_length("session_presets"."entries") BETWEEN 1 AND 50),
	CONSTRAINT "session_presets_updated_by_name" CHECK("session_presets"."updated_by_name" IS NULL OR length(trim("session_presets"."updated_by_name")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_presets_public_id_unique` ON `session_presets` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_presets_name_key` ON `session_presets` (`application_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `application_previews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`key` text NOT NULL,
	`ref` text NOT NULL,
	`current_preview_id` integer,
	`latest_preview_id` integer,
	`latest_preparation_id` integer,
	`latest_commit_sha` text NOT NULL,
	`latest_outcome` text DEFAULT 'building' NOT NULL,
	`latest_reasons` text,
	`latest_facts` text,
	`latest_requested_at` integer NOT NULL,
	`remote_missing_at` integer,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_preview_id`) REFERENCES `preview_builds`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`latest_preview_id`) REFERENCES `preview_builds`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`latest_preparation_id`) REFERENCES `preview_preparations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_previews_public_id" CHECK("application_previews"."public_id" GLOB 'apv_*'),
	CONSTRAINT "application_previews_key" CHECK(length("application_previews"."key") BETWEEN 1 AND 60 AND "application_previews"."key" NOT GLOB '*[^a-z0-9.-]*' AND "application_previews"."key" NOT GLOB '-*' AND "application_previews"."key" NOT GLOB '*-' AND "application_previews"."key" NOT GLOB '*--*'),
	CONSTRAINT "application_previews_ref" CHECK(("application_previews"."ref" GLOB 'refs/heads/?*' OR "application_previews"."ref" GLOB 'refs/tags/?*') AND length("application_previews"."ref") <= 266),
	CONSTRAINT "application_previews_latest_commit" CHECK(length("application_previews"."latest_commit_sha") = 40 AND "application_previews"."latest_commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "application_previews_latest_outcome" CHECK(latest_outcome IN ('building', 'ready', 'failed', 'not_previewable')),
	CONSTRAINT "application_previews_latest_reasons" CHECK(("application_previews"."latest_outcome" IN ('failed', 'not_previewable')) = ("application_previews"."latest_reasons" IS NOT NULL) AND ("application_previews"."latest_reasons" IS NULL OR (json_valid("application_previews"."latest_reasons") AND json_type("application_previews"."latest_reasons") = 'array' AND json_array_length("application_previews"."latest_reasons") > 0))),
	CONSTRAINT "application_previews_latest_facts" CHECK("application_previews"."latest_facts" IS NULL OR (json_valid("application_previews"."latest_facts") AND json_type("application_previews"."latest_facts") = 'object')),
	CONSTRAINT "application_previews_ready" CHECK("application_previews"."latest_outcome" <> 'ready' OR ("application_previews"."current_preview_id" IS NOT NULL AND "application_previews"."current_preview_id" = "application_previews"."latest_preview_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_previews_public_id_unique` ON `application_previews` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_previews_key` ON `application_previews` (`application_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_previews_ref` ON `application_previews` (`application_id`,`ref`);--> statement-breakpoint
CREATE INDEX `application_previews_current_preview` ON `application_previews` (`current_preview_id`);--> statement-breakpoint
CREATE INDEX `application_previews_latest_preview` ON `application_previews` (`latest_preview_id`);--> statement-breakpoint
CREATE INDEX `application_previews_latest_preparation` ON `application_previews` (`latest_preparation_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_demo_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`view_workspace_id` integer NOT NULL,
	`route` text NOT NULL,
	`commit_sha` text NOT NULL,
	`application_preview_id` integer,
	`preview_ref` text,
	`anchor` text NOT NULL,
	`offset_x` real NOT NULL,
	`offset_y` real NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_preview_id`) REFERENCES `application_previews`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "demo_threads_public_id" CHECK("__new_demo_threads"."public_id" GLOB 'thr_*'),
	CONSTRAINT "demo_threads_status" CHECK(status IN ('open', 'resolved')),
	CONSTRAINT "demo_threads_offsets" CHECK("__new_demo_threads"."offset_x" BETWEEN 0 AND 1 AND "__new_demo_threads"."offset_y" BETWEEN 0 AND 1),
	CONSTRAINT "demo_threads_resolved" CHECK(("__new_demo_threads"."status" = 'resolved') = ("__new_demo_threads"."resolved_at" IS NOT NULL)),
	CONSTRAINT "demo_threads_route" CHECK("__new_demo_threads"."route" GLOB '/*' AND length("__new_demo_threads"."route") <= 2048),
	CONSTRAINT "demo_threads_commit_sha" CHECK(length("__new_demo_threads"."commit_sha") = 40 AND "__new_demo_threads"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "demo_threads_anchor" CHECK(json_valid("__new_demo_threads"."anchor") AND json_type("__new_demo_threads"."anchor") = 'object'),
	CONSTRAINT "demo_threads_preview_ref" CHECK(("__new_demo_threads"."preview_ref" IS NULL OR (("__new_demo_threads"."preview_ref" GLOB 'refs/heads/?*' OR "__new_demo_threads"."preview_ref" GLOB 'refs/tags/?*') AND length("__new_demo_threads"."preview_ref") <= 266)) AND ("__new_demo_threads"."application_preview_id" IS NULL OR "__new_demo_threads"."preview_ref" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_demo_threads`("id", "public_id", "application_id", "view_workspace_id", "route", "commit_sha", "application_preview_id", "preview_ref", "anchor", "offset_x", "offset_y", "status", "created_at", "resolved_at") SELECT "id", "public_id", "application_id", "view_workspace_id", "route", "commit_sha", NULL, NULL, "anchor", "offset_x", "offset_y", "status", "created_at", "resolved_at" FROM `demo_threads`;--> statement-breakpoint
DROP TABLE `demo_threads`;--> statement-breakpoint
ALTER TABLE `__new_demo_threads` RENAME TO `demo_threads`;--> statement-breakpoint
CREATE UNIQUE INDEX `demo_threads_public_id_unique` ON `demo_threads` (`public_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_view` ON `demo_threads` (`application_id`,`view_workspace_id`);--> statement-breakpoint
CREATE INDEX `demo_threads_workspace` ON `demo_threads` (`view_workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `demo_threads_application_preview` ON `demo_threads` (`application_preview_id`);--> statement-breakpoint
CREATE TABLE `__new_demo_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_digest` text NOT NULL,
	`application_id` integer NOT NULL,
	`view_workspace_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`route` text NOT NULL,
	`application_preview_id` integer,
	`preview_ref` text,
	`view` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_preview_id`) REFERENCES `application_previews`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "demo_shares_token_digest" CHECK(length("__new_demo_shares"."token_digest") = 64),
	CONSTRAINT "demo_shares_commit_sha" CHECK(length("__new_demo_shares"."commit_sha") = 40 AND "__new_demo_shares"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "demo_shares_route" CHECK("__new_demo_shares"."route" GLOB '/*' AND length("__new_demo_shares"."route") <= 2048),
	CONSTRAINT "demo_shares_preview_ref" CHECK(("__new_demo_shares"."preview_ref" IS NULL OR (("__new_demo_shares"."preview_ref" GLOB 'refs/heads/?*' OR "__new_demo_shares"."preview_ref" GLOB 'refs/tags/?*') AND length("__new_demo_shares"."preview_ref") <= 266)) AND ("__new_demo_shares"."application_preview_id" IS NULL OR "__new_demo_shares"."preview_ref" IS NOT NULL)),
	CONSTRAINT "demo_shares_view" CHECK(json_valid("__new_demo_shares"."view") AND json_type("__new_demo_shares"."view") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_demo_shares`("id", "token_digest", "application_id", "view_workspace_id", "commit_sha", "route", "application_preview_id", "preview_ref", "view", "created_at") SELECT "id", "token_digest", "application_id", "view_workspace_id", "commit_sha", "route", NULL, NULL, '{}', "created_at" FROM `demo_shares`;--> statement-breakpoint
DROP TABLE `demo_shares`;--> statement-breakpoint
ALTER TABLE `__new_demo_shares` RENAME TO `demo_shares`;--> statement-breakpoint
CREATE UNIQUE INDEX `demo_shares_token_digest_unique` ON `demo_shares` (`token_digest`);--> statement-breakpoint
CREATE INDEX `demo_shares_view_workspace` ON `demo_shares` (`view_workspace_id`);--> statement-breakpoint
CREATE INDEX `demo_shares_application` ON `demo_shares` (`application_id`);--> statement-breakpoint
CREATE INDEX `demo_shares_application_preview` ON `demo_shares` (`application_preview_id`);
--> statement-breakpoint
-- A saved preview keeps its application, key, and ref.
CREATE TRIGGER application_previews_identity_fixed
BEFORE UPDATE ON application_previews
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.application_id IS NOT OLD.application_id OR NEW."key" IS NOT OLD."key"
  OR NEW.ref IS NOT OLD.ref OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'application_previews: a saved preview keeps its application, key, and ref');
END;
--> statement-breakpoint
-- Its builds are previews of its application's Repository and package, and its latest attempt's are of the latest commit.
CREATE TRIGGER application_previews_builds_own_insert
BEFORE INSERT ON application_previews
WHEN (NEW.current_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_builds b JOIN applications a ON a.id = NEW.application_id WHERE b.id = NEW.current_preview_id AND b.repository_source_id = a.repository_source_id AND b.package_dir = a.package_dir))
  OR (NEW.latest_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_builds b JOIN applications a ON a.id = NEW.application_id WHERE b.id = NEW.latest_preview_id AND b.repository_source_id = a.repository_source_id AND b.package_dir = a.package_dir AND b.commit_sha = NEW.latest_commit_sha))
  OR (NEW.latest_preparation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_preparations p JOIN applications a ON a.id = NEW.application_id WHERE p.id = NEW.latest_preparation_id AND p.repository_source_id = a.repository_source_id AND p.commit_sha = NEW.latest_commit_sha))
BEGIN
	SELECT RAISE(ABORT, 'application_previews: builds are previews of the application''s Repository and package, and the latest attempt''s are of its latest commit');
END;
--> statement-breakpoint
CREATE TRIGGER application_previews_builds_own_update
BEFORE UPDATE OF current_preview_id, latest_preview_id, latest_preparation_id, latest_commit_sha ON application_previews
WHEN (NEW.current_preview_id IS NOT NULL AND NEW.current_preview_id IS NOT OLD.current_preview_id AND NOT EXISTS (SELECT 1 FROM preview_builds b JOIN applications a ON a.id = NEW.application_id WHERE b.id = NEW.current_preview_id AND b.repository_source_id = a.repository_source_id AND b.package_dir = a.package_dir))
  OR (NEW.latest_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_builds b JOIN applications a ON a.id = NEW.application_id WHERE b.id = NEW.latest_preview_id AND b.repository_source_id = a.repository_source_id AND b.package_dir = a.package_dir AND b.commit_sha = NEW.latest_commit_sha))
  OR (NEW.latest_preparation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_preparations p JOIN applications a ON a.id = NEW.application_id WHERE p.id = NEW.latest_preparation_id AND p.repository_source_id = a.repository_source_id AND p.commit_sha = NEW.latest_commit_sha))
BEGIN
	SELECT RAISE(ABORT, 'application_previews: builds are previews of the application''s Repository and package, and the latest attempt''s are of its latest commit');
END;
--> statement-breakpoint
-- A thread's or share link's saved preview is one of its own application's.
CREATE TRIGGER demo_threads_preview_own_insert
BEFORE INSERT ON demo_threads
WHEN NEW.application_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_previews p WHERE p.id = NEW.application_preview_id AND p.application_id = NEW.application_id)
BEGIN
	SELECT RAISE(ABORT, 'demo_threads: a thread''s saved preview is one of its application''s');
END;
--> statement-breakpoint
CREATE TRIGGER demo_threads_preview_own_update
BEFORE UPDATE OF application_preview_id, application_id ON demo_threads
WHEN NEW.application_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_previews p WHERE p.id = NEW.application_preview_id AND p.application_id = NEW.application_id)
BEGIN
	SELECT RAISE(ABORT, 'demo_threads: a thread''s saved preview is one of its application''s');
END;
--> statement-breakpoint
CREATE TRIGGER demo_shares_preview_own_insert
BEFORE INSERT ON demo_shares
WHEN NEW.application_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_previews p WHERE p.id = NEW.application_preview_id AND p.application_id = NEW.application_id)
BEGIN
	SELECT RAISE(ABORT, 'demo_shares: a share link''s saved preview is one of its application''s');
END;
--> statement-breakpoint
CREATE TRIGGER demo_shares_preview_own_update
BEFORE UPDATE OF application_preview_id, application_id ON demo_shares
WHEN NEW.application_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_previews p WHERE p.id = NEW.application_preview_id AND p.application_id = NEW.application_id)
BEGIN
	SELECT RAISE(ABORT, 'demo_shares: a share link''s saved preview is one of its application''s');
END;
--> statement-breakpoint
-- A preset keeps its application.
CREATE TRIGGER session_presets_identity_fixed
BEFORE UPDATE ON session_presets
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.application_id IS NOT OLD.application_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'session_presets: a preset keeps its application');
END;
--> statement-breakpoint
-- A workspace chooses one of the application's own presets.
CREATE TRIGGER session_preset_choices_own_insert
BEFORE INSERT ON session_preset_choices
WHEN NOT EXISTS (SELECT 1 FROM session_presets p WHERE p.id = NEW.preset_id AND p.application_id = NEW.application_id)
BEGIN
	SELECT RAISE(ABORT, 'session_preset_choices: the chosen preset is one of the application''s');
END;
--> statement-breakpoint
CREATE TRIGGER session_preset_choices_own_update
BEFORE UPDATE OF preset_id, application_id ON session_preset_choices
WHEN NOT EXISTS (SELECT 1 FROM session_presets p WHERE p.id = NEW.preset_id AND p.application_id = NEW.application_id)
BEGIN
	SELECT RAISE(ABORT, 'session_preset_choices: the chosen preset is one of the application''s');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- The rebuilt tables keep every reference to and from them intact.
CREATE TEMP TABLE saved_previews_and_session_presets_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO saved_previews_and_session_presets_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE saved_previews_and_session_presets_foreign_keys;
