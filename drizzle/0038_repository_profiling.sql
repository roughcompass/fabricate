-- Repository profiling (docs/profiling.md): every repository is profiled in
-- the background, and each profile is a numbered version of it. Each version
-- is a Run of one system-owned initiative, scoped by its launch to that
-- repository alone; profile_versions numbers them per repository and records
-- why each was queued. Background jobs wait behind work people start.
CREATE TABLE `profile_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repository_source_id` integer NOT NULL,
	`assessment_id` integer NOT NULL,
	`version` integer NOT NULL,
	`trigger` text NOT NULL,
	`head_commit` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "profile_versions_version" CHECK("profile_versions"."version" >= 1),
	CONSTRAINT "profile_versions_trigger" CHECK(trigger IN ('imported', 'added', 'edited', 'manual', 'initial', 'commit', 'detector')),
	CONSTRAINT "profile_versions_head_commit" CHECK("profile_versions"."head_commit" IS NULL OR (length("profile_versions"."head_commit") = 40 AND "profile_versions"."head_commit" NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_assessment_id_unique` ON `profile_versions` (`assessment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_number` ON `profile_versions` (`repository_source_id`,`version`);--> statement-breakpoint
CREATE INDEX `profile_versions_source` ON `profile_versions` (`repository_source_id`,`id`);--> statement-breakpoint
CREATE TRIGGER profile_versions_immutable
BEFORE UPDATE ON profile_versions
BEGIN
	SELECT RAISE(ABORT, 'profile_versions: versions are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER profile_versions_never_deleted
BEFORE DELETE ON profile_versions
BEGIN
	SELECT RAISE(ABORT, 'profile_versions: versions are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A version is a Run of the Repository profiling initiative that profiles its repository.
CREATE TRIGGER profile_versions_profiling_run
BEFORE INSERT ON profile_versions
WHEN (SELECT i.profiling FROM assessments a JOIN initiatives i ON i.id = a.initiative_id WHERE a.id = NEW.assessment_id) IS NOT 1
  OR NOT EXISTS (SELECT 1 FROM assessment_targets t WHERE t.assessment_id = NEW.assessment_id AND t.repository_source_id = NEW.repository_source_id)
BEGIN
	SELECT RAISE(ABORT, 'profile_versions: a version is a Repository profiling Run of its repository');
END;
--> statement-breakpoint
DROP INDEX `jobs_claimable`;--> statement-breakpoint
ALTER TABLE `jobs` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_claimable` ON `jobs` (`state`,`priority`,`run_after`);--> statement-breakpoint
-- The column is added in place rather than by rebuilding initiatives, which
-- would drop its triggers and the ones on other tables that read it.
ALTER TABLE `initiatives` ADD COLUMN `profiling` integer DEFAULT false NOT NULL CONSTRAINT "initiatives_profiling" CHECK(`profiling` IN (0, 1) AND NOT (`profiling` = 1 AND (`system_owned` = 1 OR `claim_repository_source_id` IS NOT NULL)));--> statement-breakpoint
INSERT INTO initiatives (public_id, name, objective, selection_mode, profiling, created_at, updated_at)
VALUES (
  'ini_repoprofiling000',
  'Repository profiling',
  'Profiles every enabled repository when it''s added, imported, edited, or re-profiled, when its reference has new commits, and when the detector changes. DE FabLab owns it, and each Run names its repository.',
  'explicit',
  1,
  cast(unixepoch('subsec') * 1000 as integer),
  cast(unixepoch('subsec') * 1000 as integer)
);--> statement-breakpoint
CREATE TRIGGER initiatives_profiling_insert
BEFORE INSERT ON initiatives
WHEN NEW.profiling = 1
BEGIN
	SELECT RAISE(ABORT, 'initiatives: only DE FabLab creates the Repository profiling initiative');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_profiling_kept
BEFORE UPDATE ON initiatives
WHEN NEW.profiling IS NOT OLD.profiling
  OR (OLD.profiling = 1 AND (NEW.name IS NOT OLD.name OR NEW.objective IS NOT OLD.objective OR NEW.selection_mode IS NOT OLD.selection_mode))
BEGIN
	SELECT RAISE(ABORT, 'initiatives: the Repository profiling initiative keeps its name, objective, and scope');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_profiling_never_deleted
BEFORE DELETE ON initiatives
WHEN OLD.profiling = 1
BEGIN
	SELECT RAISE(ABORT, 'initiatives: the Repository profiling initiative is retained');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_not_profiling
BEFORE INSERT ON initiative_targets
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_targets: each Repository profiling Run names its own repository');
END;
--> statement-breakpoint
-- Profiles aren't evaluated, so the initiative holds no Standard Releases.
CREATE TRIGGER initiative_standard_releases_not_profiling
BEFORE INSERT ON initiative_standard_releases
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_standard_releases: Repository profiling Runs are not evaluated');
END;
