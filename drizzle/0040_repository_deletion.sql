-- Deleting a Repository (docs/profiling.md, "Deleting a Repository"): the row
-- stays as a tombstone, because past Runs, profiles, and ownership claims
-- point at it and are retained. A deleted Repository leaves the catalog, and
-- its clone URL is free to register again.
DROP INDEX `repository_sources_canonical_url`;--> statement-breakpoint
ALTER TABLE `repository_sources` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `repository_sources_canonical_url` ON `repository_sources` (`canonical_url`) WHERE "repository_sources"."deleted_at" IS NULL;--> statement-breakpoint
-- Deletion is permanent, and a deleted Repository is never edited.
CREATE TRIGGER repository_sources_deletion_final
BEFORE UPDATE ON repository_sources
WHEN OLD.deleted_at IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'repository_sources: a deleted repository stays deleted and is never edited');
END;
