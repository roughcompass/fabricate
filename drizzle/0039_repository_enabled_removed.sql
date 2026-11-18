-- Repositories are no longer enabled or disabled: every Repository is in
-- the catalog's scope, profiled, and offered to Assessments, and a clone URL
-- names at most one Repository. An Assessment that targeted all enabled
-- Repositories targets all of them. A Repository disabled until now joins
-- them; two entries with one canonical clone URL, possible only while one was
-- disabled, stop this migration rather than merge silently.
--
-- Both tables' CHECKs change, so both are rebuilt. The triggers on them, and
-- the ones on other tables that read them, step aside and come back after,
-- worded for the new scope.
DROP TRIGGER repository_sources_identity_immutable;--> statement-breakpoint
DROP TRIGGER repository_sources_never_deleted;--> statement-breakpoint
DROP TRIGGER assessment_targets_kind_matches_initiative;--> statement-breakpoint
DROP TRIGGER initiatives_all_enabled_has_no_targets;--> statement-breakpoint
DROP TRIGGER initiatives_identity_immutable;--> statement-breakpoint
DROP TRIGGER initiatives_claim_explicit_insert;--> statement-breakpoint
DROP TRIGGER initiatives_claim_kept;--> statement-breakpoint
DROP TRIGGER initiatives_claim_never_deleted;--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_insert;--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_kept;--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_never_deleted;--> statement-breakpoint
DROP TRIGGER initiative_targets_not_system_owned;--> statement-breakpoint
DROP TRIGGER initiative_targets_require_explicit_mode;--> statement-breakpoint
DROP TRIGGER initiative_targets_claim_only;--> statement-breakpoint
DROP TRIGGER initiative_targets_claim_kept;--> statement-breakpoint
DROP TRIGGER profile_versions_profiling_run;--> statement-breakpoint
DROP TRIGGER initiatives_profiling_insert;--> statement-breakpoint
DROP TRIGGER initiatives_profiling_kept;--> statement-breakpoint
DROP TRIGGER initiatives_profiling_never_deleted;--> statement-breakpoint
DROP TRIGGER initiative_targets_not_profiling;--> statement-breakpoint
DROP TRIGGER initiative_standard_releases_not_profiling;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_initiatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`selection_mode` text DEFAULT 'all' NOT NULL,
	`claim_repository_source_id` integer,
	`system_owned` integer DEFAULT false NOT NULL,
	`profiling` integer DEFAULT false NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`claim_repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "initiatives_public_id" CHECK("__new_initiatives"."public_id" GLOB 'ini_*'),
	CONSTRAINT "initiatives_name" CHECK(length(trim("__new_initiatives"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "initiatives_objective" CHECK(length("__new_initiatives"."objective") <= 2000),
	CONSTRAINT "initiatives_selection_mode" CHECK(selection_mode IN ('all', 'explicit')),
	CONSTRAINT "initiatives_system_owned" CHECK("__new_initiatives"."system_owned" IN (0, 1)),
	CONSTRAINT "initiatives_profiling" CHECK("__new_initiatives"."profiling" IN (0, 1) AND NOT ("__new_initiatives"."profiling" = 1 AND ("__new_initiatives"."system_owned" = 1 OR "__new_initiatives"."claim_repository_source_id" IS NOT NULL)))
);
--> statement-breakpoint
INSERT INTO `__new_initiatives`("id", "public_id", "name", "objective", "selection_mode", "claim_repository_source_id", "system_owned", "profiling", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "name", "objective", CASE "selection_mode" WHEN 'all_enabled' THEN 'all' ELSE "selection_mode" END, "claim_repository_source_id", "system_owned", "profiling", "lock_version", "created_at", "updated_at" FROM `initiatives`;--> statement-breakpoint
DROP TABLE `initiatives`;--> statement-breakpoint
ALTER TABLE `__new_initiatives` RENAME TO `initiatives`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_public_id_unique` ON `initiatives` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_claim_repository_source` ON `initiatives` (`claim_repository_source_id`);--> statement-breakpoint
CREATE TABLE `__new_repository_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`clone_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`git_ref` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "repository_sources_public_id" CHECK("__new_repository_sources"."public_id" GLOB 'src_*'),
	CONSTRAINT "repository_sources_name" CHECK(length(trim("__new_repository_sources"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "repository_sources_urls" CHECK(length("__new_repository_sources"."clone_url") > 0 AND length("__new_repository_sources"."canonical_url") > 0),
	CONSTRAINT "repository_sources_git_ref" CHECK("__new_repository_sources"."git_ref" IS NULL OR length("__new_repository_sources"."git_ref") BETWEEN 1 AND 255)
);
--> statement-breakpoint
INSERT INTO `__new_repository_sources`("id", "public_id", "name", "clone_url", "canonical_url", "git_ref", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "name", "clone_url", "canonical_url", "git_ref", "lock_version", "created_at", "updated_at" FROM `repository_sources`;--> statement-breakpoint
DROP TABLE `repository_sources`;--> statement-breakpoint
ALTER TABLE `__new_repository_sources` RENAME TO `repository_sources`;--> statement-breakpoint
CREATE UNIQUE INDEX `repository_sources_public_id_unique` ON `repository_sources` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repository_sources_canonical_url` ON `repository_sources` (`canonical_url`);--> statement-breakpoint
CREATE TRIGGER repository_sources_identity_immutable
BEFORE UPDATE OF public_id, created_at ON repository_sources
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'repository_sources: public identity cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER repository_sources_never_deleted
BEFORE DELETE ON repository_sources
BEGIN
  SELECT RAISE(ABORT, 'repository_sources: sources are disabled, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_kind_matches_initiative
BEFORE INSERT ON assessment_targets
WHEN (NEW.kind = 'template') IS NOT (
  SELECT initiatives.system_owned = 1 FROM assessments JOIN initiatives ON initiatives.id = assessments.initiative_id WHERE assessments.id = NEW.assessment_id
)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: template versions are assessed under the Salt Patterns initiative only');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_all_has_no_targets
BEFORE UPDATE OF selection_mode ON initiatives
WHEN NEW.selection_mode = 'all' AND EXISTS (SELECT 1 FROM initiative_targets WHERE initiative_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'initiatives: remove explicit selections before targeting every repository');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_identity_immutable
BEFORE UPDATE OF public_id, created_at ON initiatives
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'initiatives: public identity cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_claim_explicit_insert
BEFORE INSERT ON initiatives
WHEN NEW.claim_repository_source_id IS NOT NULL AND NEW.selection_mode IS NOT 'explicit'
BEGIN
  SELECT RAISE(ABORT, 'initiatives: a system-owned initiative selects its repository explicitly');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_claim_kept
BEFORE UPDATE ON initiatives
WHEN NEW.claim_repository_source_id IS NOT OLD.claim_repository_source_id
  OR (NEW.claim_repository_source_id IS NOT NULL AND NEW.selection_mode IS NOT 'explicit')
BEGIN
  SELECT RAISE(ABORT, 'initiatives: a system-owned initiative keeps its one repository');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_claim_never_deleted
BEFORE DELETE ON initiatives
WHEN OLD.claim_repository_source_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'initiatives: a system-owned initiative is retained');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_system_owned_insert
BEFORE INSERT ON initiatives
WHEN NEW.system_owned = 1
BEGIN
  SELECT RAISE(ABORT, 'initiatives: only DE FabLab creates the Salt Patterns initiative');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_system_owned_kept
BEFORE UPDATE ON initiatives
WHEN NEW.system_owned IS NOT OLD.system_owned
  OR (OLD.system_owned = 1 AND (
    NEW.name IS NOT OLD.name
    OR NEW.objective IS NOT OLD.objective
    OR NEW.selection_mode IS NOT OLD.selection_mode
    OR NEW.claim_repository_source_id IS NOT OLD.claim_repository_source_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'initiatives: the Salt Patterns initiative keeps its name, objective, and scope');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_system_owned_never_deleted
BEFORE DELETE ON initiatives
WHEN OLD.system_owned = 1
BEGIN
  SELECT RAISE(ABORT, 'initiatives: the Salt Patterns initiative is retained');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_not_system_owned
BEFORE INSERT ON initiative_targets
WHEN (SELECT system_owned FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: the Salt Patterns initiative assesses template versions, not catalog sources');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_require_explicit_mode
BEFORE INSERT ON initiative_targets
WHEN (SELECT selection_mode FROM initiatives WHERE id = NEW.initiative_id) <> 'explicit'
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: only explicit initiatives select sources');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_claim_only
BEFORE INSERT ON initiative_targets
WHEN EXISTS (
  SELECT 1 FROM initiatives
  WHERE id = NEW.initiative_id AND claim_repository_source_id IS NOT NULL AND claim_repository_source_id IS NOT NEW.repository_source_id
)
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: a system-owned initiative selects only its own repository');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_claim_kept
BEFORE DELETE ON initiative_targets
WHEN EXISTS (SELECT 1 FROM initiatives WHERE id = OLD.initiative_id AND claim_repository_source_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: a system-owned initiative keeps its repository');
END;
--> statement-breakpoint
CREATE TRIGGER profile_versions_profiling_run
BEFORE INSERT ON profile_versions
WHEN (SELECT i.profiling FROM assessments a JOIN initiatives i ON i.id = a.initiative_id WHERE a.id = NEW.assessment_id) IS NOT 1
  OR NOT EXISTS (SELECT 1 FROM assessment_targets t WHERE t.assessment_id = NEW.assessment_id AND t.repository_source_id = NEW.repository_source_id)
BEGIN
	SELECT RAISE(ABORT, 'profile_versions: a version is a Repository profiling Run of its repository');
END;
--> statement-breakpoint
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
CREATE TRIGGER initiative_standard_releases_not_profiling
BEFORE INSERT ON initiative_standard_releases
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_standard_releases: Repository profiling Runs are not evaluated');
END;
--> statement-breakpoint
-- Every row the rebuilds copied still points at what it pointed at before;
-- a violation fails the migration, and the whole run rolls back.
CREATE TEMP TABLE repository_enabled_removed_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO repository_enabled_removed_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE repository_enabled_removed_foreign_keys;
