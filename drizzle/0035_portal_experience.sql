CREATE TABLE `portal_experience_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`portal_id` integer NOT NULL,
	`number` integer NOT NULL,
	`document` text NOT NULL,
	`change_count` integer NOT NULL,
	`changes` text NOT NULL,
	`actor` text NOT NULL,
	`attribution` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_experience_versions_public_id" CHECK("portal_experience_versions"."public_id" GLOB 'pxv_*'),
	CONSTRAINT "portal_experience_versions_number_positive" CHECK("portal_experience_versions"."number" >= 1),
	CONSTRAINT "portal_experience_versions_document" CHECK(json_valid("portal_experience_versions"."document") AND json_type("portal_experience_versions"."document") = 'object' AND length("portal_experience_versions"."document") <= 262144),
	CONSTRAINT "portal_experience_versions_changes" CHECK(json_valid("portal_experience_versions"."changes") AND json_type("portal_experience_versions"."changes") = 'array' AND length("portal_experience_versions"."changes") <= 65536),
	CONSTRAINT "portal_experience_versions_change_count" CHECK("portal_experience_versions"."change_count" BETWEEN 1 AND 10000),
	CONSTRAINT "portal_experience_versions_actor" CHECK(length(trim("portal_experience_versions"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "portal_experience_versions_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_experience_versions_public_id_unique` ON `portal_experience_versions` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_experience_versions_number` ON `portal_experience_versions` (`portal_id`,`number`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_onboarding_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`portal_id` integer,
	`application_id` integer,
	`event` text NOT NULL,
	`from_lifecycle` text,
	`to_lifecycle` text,
	`detail` text,
	`actor` text NOT NULL,
	`attribution` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "onboarding_events_subject" CHECK(CASE "__new_onboarding_events"."subject"
      WHEN 'portal' THEN "__new_onboarding_events"."portal_id" IS NOT NULL AND "__new_onboarding_events"."application_id" IS NULL
      WHEN 'application' THEN "__new_onboarding_events"."application_id" IS NOT NULL AND "__new_onboarding_events"."portal_id" IS NULL
      ELSE 0 END),
	CONSTRAINT "onboarding_events_event" CHECK(event IN ('created', 'details_changed', 'menu_changed', 'default_changed', 'promoted', 'returned_to_prototype', 'experience_saved')),
	CONSTRAINT "onboarding_events_lifecycle" CHECK((from_lifecycle IS NULL OR from_lifecycle IN ('prototype', 'production')) AND (to_lifecycle IS NULL OR to_lifecycle IN ('prototype', 'production'))),
	CONSTRAINT "onboarding_events_detail" CHECK("__new_onboarding_events"."detail" IS NULL OR length(trim("__new_onboarding_events"."detail")) BETWEEN 1 AND 500),
	CONSTRAINT "onboarding_events_actor" CHECK(length(trim("__new_onboarding_events"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "onboarding_events_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_onboarding_events`("id", "subject", "portal_id", "application_id", "event", "from_lifecycle", "to_lifecycle", "detail", "actor", "attribution", "occurred_at") SELECT "id", "subject", "portal_id", "application_id", "event", "from_lifecycle", "to_lifecycle", "detail", "actor", "attribution", "occurred_at" FROM `onboarding_events`;--> statement-breakpoint
DROP TABLE `onboarding_events`;--> statement-breakpoint
ALTER TABLE `__new_onboarding_events` RENAME TO `onboarding_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `onboarding_events_portal` ON `onboarding_events` (`portal_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `onboarding_events_application` ON `onboarding_events` (`application_id`,`occurred_at`);--> statement-breakpoint
-- Rebuilding the table dropped its triggers; history stays append-only.
CREATE TRIGGER onboarding_events_immutable
BEFORE UPDATE ON onboarding_events
BEGIN
	SELECT RAISE(ABORT, 'onboarding_events: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_events_never_deleted
BEFORE DELETE ON onboarding_events
BEGIN
	SELECT RAISE(ABORT, 'onboarding_events: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A saved experience version is recorded once and kept.
CREATE TRIGGER portal_experience_versions_immutable
BEFORE UPDATE ON portal_experience_versions
BEGIN
	SELECT RAISE(ABORT, 'portal_experience_versions: versions are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER portal_experience_versions_never_deleted
BEFORE DELETE ON portal_experience_versions
BEGIN
	SELECT RAISE(ABORT, 'portal_experience_versions: versions are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Versions of a Portal are numbered 1, 2, 3, … with no gaps.
CREATE TRIGGER portal_experience_versions_sequence
BEFORE INSERT ON portal_experience_versions
WHEN NEW.number <> COALESCE((SELECT MAX(number) FROM portal_experience_versions WHERE portal_id = NEW.portal_id), 0) + 1
BEGIN
	SELECT RAISE(ABORT, 'portal_experience_versions: a Portal''s versions are numbered in order');
END;
