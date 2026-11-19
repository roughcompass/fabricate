-- A Standard's one draft becomes columns of the Standard (prune-and-consolidate-code,
-- design decision 11): its document, its own lock version, when it was last
-- saved, and the Release it revises. Each draft is copied over, then the
-- table goes. The trigger on standards steps aside for the rebuild and comes
-- back after it.
DROP TRIGGER standards_identity_immutable;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_standards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`draft_document` text,
	`draft_lock_version` integer,
	`draft_saved_at` integer,
	`draft_based_on_release_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_based_on_release_id`) REFERENCES `standard_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "standards_public_id" CHECK("__new_standards"."public_id" GLOB 'std_*'),
	CONSTRAINT "standards_name_length" CHECK(length(trim("__new_standards"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "standards_purpose_length" CHECK(length(trim("__new_standards"."purpose")) BETWEEN 1 AND 2000),
	CONSTRAINT "standards_draft" CHECK(("__new_standards"."draft_document" IS NULL) = ("__new_standards"."draft_lock_version" IS NULL) AND ("__new_standards"."draft_document" IS NULL) = ("__new_standards"."draft_saved_at" IS NULL) AND ("__new_standards"."draft_document" IS NOT NULL OR "__new_standards"."draft_based_on_release_id" IS NULL)),
	CONSTRAINT "standards_draft_document" CHECK("__new_standards"."draft_document" IS NULL OR (json_valid("__new_standards"."draft_document") AND json_type("__new_standards"."draft_document") = 'object'))
);
--> statement-breakpoint
INSERT INTO `__new_standards`("id", "public_id", "name", "purpose", "lock_version", "draft_document", "draft_lock_version", "draft_saved_at", "draft_based_on_release_id", "created_at", "updated_at") SELECT s."id", s."public_id", s."name", s."purpose", s."lock_version", d."document", d."lock_version", d."updated_at", d."based_on_release_id", s."created_at", s."updated_at" FROM `standards` s LEFT JOIN `standard_drafts` d ON d."standard_id" = s."id";--> statement-breakpoint
DROP TABLE `standard_drafts`;--> statement-breakpoint
DROP TABLE `standards`;--> statement-breakpoint
ALTER TABLE `__new_standards` RENAME TO `standards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `standards_public_id_unique` ON `standards` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `standards_name` ON `standards` (lower("name"));--> statement-breakpoint
CREATE TRIGGER standards_identity_immutable
BEFORE UPDATE OF public_id, created_at ON standards
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'standards: public identity cannot change');
END;
