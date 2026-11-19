-- Applications (add-applications, design decision 1): a frontend app built
-- from one Repository's package, tracking one branch, pointing at the
-- repository previews that are its current build and its latest attempt.
-- Screenshots (design decision 4) are kept per preview, apart from
-- preview_builds, so capturing one never touches a build row.
CREATE TABLE `preview_screenshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`preview_id` integer NOT NULL,
	`artifact` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`directory` text,
	`reason` text,
	`requested_at` integer NOT NULL,
	`captured_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`preview_id`) REFERENCES `preview_builds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "preview_screenshots_state" CHECK(state IN ('pending', 'ready', 'unavailable')),
	CONSTRAINT "preview_screenshots_artifact" CHECK(length("preview_screenshots"."artifact") BETWEEN 1 AND 255),
	CONSTRAINT "preview_screenshots_ready" CHECK(("preview_screenshots"."state" = 'ready') = ("preview_screenshots"."directory" IS NOT NULL AND "preview_screenshots"."captured_at" IS NOT NULL)),
	CONSTRAINT "preview_screenshots_unavailable" CHECK(("preview_screenshots"."state" = 'unavailable') = ("preview_screenshots"."reason" IS NOT NULL AND length("preview_screenshots"."reason") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_screenshots_preview_id_unique` ON `preview_screenshots` (`preview_id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`repository_source_id` integer NOT NULL,
	`package_dir` text NOT NULL,
	`tracked_ref` text NOT NULL,
	`current_preview_id` integer,
	`latest_preview_id` integer,
	`latest_preparation_id` integer,
	`latest_commit_sha` text NOT NULL,
	`latest_outcome` text DEFAULT 'building' NOT NULL,
	`latest_reasons` text,
	`latest_facts` text,
	`latest_requested_at` integer NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_preview_id`) REFERENCES `preview_builds`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`latest_preview_id`) REFERENCES `preview_builds`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`latest_preparation_id`) REFERENCES `preview_preparations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "applications_public_id" CHECK("applications"."public_id" GLOB 'app_*'),
	CONSTRAINT "applications_slug" CHECK(length("applications"."slug") BETWEEN 1 AND 80 AND "applications"."slug" NOT GLOB '*[^a-z0-9-]*' AND "applications"."slug" NOT GLOB '-*' AND "applications"."slug" NOT GLOB '*-' AND "applications"."slug" NOT GLOB '*--*' AND "applications"."slug" NOT IN ('new')),
	CONSTRAINT "applications_name" CHECK(length(trim("applications"."name")) BETWEEN 1 AND 80 AND length("applications"."name_key") > 0),
	CONSTRAINT "applications_description" CHECK(length("applications"."description") <= 280),
	CONSTRAINT "applications_package_dir" CHECK("applications"."package_dir" = '.' OR (length("applications"."package_dir") BETWEEN 1 AND 1024 AND "applications"."package_dir" NOT GLOB '/*' AND "applications"."package_dir" NOT GLOB '*/' AND "applications"."package_dir" NOT GLOB '*//*' AND ('/' || "applications"."package_dir" || '/') NOT GLOB '*/./*' AND ('/' || "applications"."package_dir" || '/') NOT GLOB '*/../*')),
	CONSTRAINT "applications_tracked_ref" CHECK("applications"."tracked_ref" GLOB 'refs/heads/?*' AND length("applications"."tracked_ref") <= 266),
	CONSTRAINT "applications_latest_commit" CHECK(length("applications"."latest_commit_sha") = 40 AND "applications"."latest_commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "applications_latest_outcome" CHECK(latest_outcome IN ('building', 'ready', 'failed', 'not_previewable')),
	CONSTRAINT "applications_latest_reasons" CHECK(("applications"."latest_outcome" IN ('failed', 'not_previewable')) = ("applications"."latest_reasons" IS NOT NULL) AND ("applications"."latest_reasons" IS NULL OR (json_valid("applications"."latest_reasons") AND json_type("applications"."latest_reasons") = 'array' AND json_array_length("applications"."latest_reasons") > 0))),
	CONSTRAINT "applications_latest_facts" CHECK("applications"."latest_facts" IS NULL OR (json_valid("applications"."latest_facts") AND json_type("applications"."latest_facts") = 'object')),
	CONSTRAINT "applications_ready" CHECK("applications"."latest_outcome" <> 'ready' OR ("applications"."current_preview_id" IS NOT NULL AND "applications"."current_preview_id" = "applications"."latest_preview_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_public_id_unique` ON `applications` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_slug` ON `applications` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_name_key` ON `applications` (`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_package` ON `applications` (`repository_source_id`,`package_dir`);--> statement-breakpoint
CREATE INDEX `applications_current_preview` ON `applications` (`current_preview_id`);--> statement-breakpoint
CREATE INDEX `applications_latest_preview` ON `applications` (`latest_preview_id`);--> statement-breakpoint
CREATE INDEX `applications_latest_preparation` ON `applications` (`latest_preparation_id`);
--> statement-breakpoint
-- An application keeps its address, Repository, and package.
CREATE TRIGGER applications_identity_fixed
BEFORE UPDATE ON applications
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.slug IS NOT OLD.slug OR NEW.repository_source_id IS NOT OLD.repository_source_id
  OR NEW.package_dir IS NOT OLD.package_dir OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'applications: an application keeps its slug, Repository, and package');
END;
--> statement-breakpoint
-- Its builds are previews of its own Repository and package, and its latest attempt's are of the latest commit.
CREATE TRIGGER applications_builds_own_insert
BEFORE INSERT ON applications
WHEN (NEW.current_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_builds b WHERE b.id = NEW.current_preview_id AND b.repository_source_id = NEW.repository_source_id AND b.package_dir = NEW.package_dir))
  OR (NEW.latest_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_builds b WHERE b.id = NEW.latest_preview_id AND b.repository_source_id = NEW.repository_source_id AND b.package_dir = NEW.package_dir AND b.commit_sha = NEW.latest_commit_sha))
  OR (NEW.latest_preparation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_preparations p WHERE p.id = NEW.latest_preparation_id AND p.repository_source_id = NEW.repository_source_id AND p.commit_sha = NEW.latest_commit_sha))
BEGIN
	SELECT RAISE(ABORT, 'applications: builds are previews of the application''s Repository and package, and the latest attempt''s are of its latest commit');
END;
--> statement-breakpoint
CREATE TRIGGER applications_builds_own_update
BEFORE UPDATE OF current_preview_id, latest_preview_id, latest_preparation_id, latest_commit_sha ON applications
WHEN (NEW.current_preview_id IS NOT NULL AND NEW.current_preview_id IS NOT OLD.current_preview_id AND NOT EXISTS (SELECT 1 FROM preview_builds b WHERE b.id = NEW.current_preview_id AND b.repository_source_id = NEW.repository_source_id AND b.package_dir = NEW.package_dir))
  OR (NEW.latest_preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_builds b WHERE b.id = NEW.latest_preview_id AND b.repository_source_id = NEW.repository_source_id AND b.package_dir = NEW.package_dir AND b.commit_sha = NEW.latest_commit_sha))
  OR (NEW.latest_preparation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preview_preparations p WHERE p.id = NEW.latest_preparation_id AND p.repository_source_id = NEW.repository_source_id AND p.commit_sha = NEW.latest_commit_sha))
BEGIN
	SELECT RAISE(ABORT, 'applications: builds are previews of the application''s Repository and package, and the latest attempt''s are of its latest commit');
END;
--> statement-breakpoint
-- A screenshot stays the screenshot of the preview it was taken for.
CREATE TRIGGER preview_screenshots_preview_fixed
BEFORE UPDATE OF preview_id ON preview_screenshots
WHEN NEW.preview_id IS NOT OLD.preview_id
BEGIN
	SELECT RAISE(ABORT, 'preview_screenshots: a screenshot keeps its preview');
END;
