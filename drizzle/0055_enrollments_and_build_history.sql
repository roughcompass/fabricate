-- Preview enrollments recorded by creating an application (add-applications,
-- applications/onboarding spec), by canonical remote identity, beside the
-- configured previews.trustedSources; and each application's build history:
-- every attempt it started, its preparation, and once its package's build
-- started, the preview and that preview's attempt.
CREATE TABLE `preview_enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_url` text NOT NULL,
	`application_public_id` text NOT NULL,
	`application_name` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "preview_enrollments_canonical_url" CHECK(length("preview_enrollments"."canonical_url") > 0),
	CONSTRAINT "preview_enrollments_application" CHECK("preview_enrollments"."application_public_id" GLOB 'app_*' AND length(trim("preview_enrollments"."application_name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_enrollments_canonical_url_unique` ON `preview_enrollments` (`canonical_url`);--> statement-breakpoint
CREATE TABLE `application_builds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`trigger` text NOT NULL,
	`tracked_ref` text NOT NULL,
	`commit_sha` text NOT NULL,
	`preparation_id` integer NOT NULL,
	`preview_id` integer,
	`attempt` integer,
	`outcome` text DEFAULT 'building' NOT NULL,
	`reasons` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preparation_id`) REFERENCES `preview_preparations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`preview_id`) REFERENCES `preview_builds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_builds_trigger" CHECK("trigger" IN ('first', 'automatic', 'rebuild', 'branch')),
	CONSTRAINT "application_builds_outcome" CHECK(outcome IN ('building', 'ready', 'failed', 'not_previewable', 'replaced')),
	CONSTRAINT "application_builds_commit" CHECK(length("application_builds"."commit_sha") = 40 AND "application_builds"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "application_builds_tracked_ref" CHECK("application_builds"."tracked_ref" GLOB 'refs/heads/?*'),
	CONSTRAINT "application_builds_attempt" CHECK(("application_builds"."preview_id" IS NULL) = ("application_builds"."attempt" IS NULL) AND ("application_builds"."attempt" IS NULL OR "application_builds"."attempt" >= 1)),
	CONSTRAINT "application_builds_reasons" CHECK(("application_builds"."outcome" IN ('failed', 'not_previewable')) = ("application_builds"."reasons" IS NOT NULL) AND ("application_builds"."reasons" IS NULL OR (json_valid("application_builds"."reasons") AND json_type("application_builds"."reasons") = 'array'))),
	CONSTRAINT "application_builds_finished" CHECK(("application_builds"."outcome" = 'building') = ("application_builds"."finished_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `application_builds_application` ON `application_builds` (`application_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `application_builds_preview` ON `application_builds` (`preview_id`,`attempt`);

--> statement-breakpoint
-- A history row's build is a preview of its application's Repository and package, at the row's commit.
CREATE TRIGGER application_builds_own_insert
BEFORE INSERT ON application_builds
WHEN NEW.preview_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM preview_builds b JOIN applications a ON a.id = NEW.application_id
  WHERE b.id = NEW.preview_id AND b.repository_source_id = a.repository_source_id AND b.package_dir = a.package_dir AND b.commit_sha = NEW.commit_sha
)
BEGIN
	SELECT RAISE(ABORT, 'application_builds: a build is a preview of the application''s Repository and package at its commit');
END;
--> statement-breakpoint
CREATE TRIGGER application_builds_own_update
BEFORE UPDATE OF preview_id, commit_sha ON application_builds
WHEN NEW.preview_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM preview_builds b JOIN applications a ON a.id = NEW.application_id
  WHERE b.id = NEW.preview_id AND b.repository_source_id = a.repository_source_id AND b.package_dir = a.package_dir AND b.commit_sha = NEW.commit_sha
)
BEGIN
	SELECT RAISE(ABORT, 'application_builds: a build is a preview of the application''s Repository and package at its commit');
END;
