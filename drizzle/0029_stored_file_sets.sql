CREATE TABLE `stored_file_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`digest` text NOT NULL,
	`files` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stored_file_sets_digest" CHECK(length("stored_file_sets"."digest") = 40 AND "stored_file_sets"."digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "stored_file_sets_files" CHECK(json_valid("stored_file_sets"."files") AND json_type("stored_file_sets"."files") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stored_file_sets_assessment_target_id_unique` ON `stored_file_sets` (`assessment_target_id`);--> statement-breakpoint
-- A template target's files are written with it, once, under its content
-- digest, and kept unchanged like the rest of a Run's results.
CREATE TRIGGER stored_file_sets_match_target
BEFORE INSERT ON stored_file_sets
WHEN (SELECT kind FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'template'
  OR NEW.digest IS NOT (SELECT content_digest FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'pending'
BEGIN
  SELECT RAISE(ABORT, 'stored_file_sets: files are stored with their pending template target, under its content digest');
END;
--> statement-breakpoint
CREATE TRIGGER stored_file_sets_immutable
BEFORE UPDATE ON stored_file_sets
BEGIN
  SELECT RAISE(ABORT, 'stored_file_sets: stored files are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER stored_file_sets_never_deleted
BEFORE DELETE ON stored_file_sets
BEGIN
  SELECT RAISE(ABORT, 'stored_file_sets: results are retained and cannot be deleted');
END;
