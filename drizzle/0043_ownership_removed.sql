-- Ownership is removed (prune-and-consolidate-code, design decision 4):
-- claims, SEAL IDs, teams, Lines of Business, portals, the DE Console
-- import, and the ontology that classified portals. Every Assessment created
-- for a claim goes with its Runs and their results, as 0036 removed the DE
-- Web initiative's, and initiatives lose the column that named a claim's
-- repository. Nothing of the dropped history is kept; this is a POC. A
-- claimed repository stays in the catalog.
--
-- Ownership, the DE Console import, and the ontology. Dropping a table drops
-- its triggers, and no remaining table refers to any of these.
DROP TABLE `ownership_supersessions`;--> statement-breakpoint
DROP TABLE `ownership_assertions`;--> statement-breakpoint
DROP TABLE `de_console_conflicts`;--> statement-breakpoint
DROP TABLE `de_console_links`;--> statement-breakpoint
DROP TABLE `de_console_reads`;--> statement-breakpoint
DROP TABLE `portals`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
DROP TABLE `lines_of_business`;--> statement-breakpoint
DROP TABLE `concept_classifications`;--> statement-breakpoint
DROP TABLE `ontology_concepts`;--> statement-breakpoint
DROP TABLE `ontology_releases`;--> statement-breakpoint
-- The triggers that read initiatives step aside for the purge and the
-- rebuild below; renaming the rebuilt table fails while any of them refers
-- to the dropped one. Those that still apply come back after, without the
-- claim's.
DROP TRIGGER initiatives_all_has_no_targets;--> statement-breakpoint
DROP TRIGGER initiatives_claim_explicit_insert;--> statement-breakpoint
DROP TRIGGER initiatives_claim_kept;--> statement-breakpoint
DROP TRIGGER initiatives_claim_never_deleted;--> statement-breakpoint
DROP TRIGGER initiatives_identity_immutable;--> statement-breakpoint
DROP TRIGGER initiatives_profiling_insert;--> statement-breakpoint
DROP TRIGGER initiatives_profiling_kept;--> statement-breakpoint
DROP TRIGGER initiatives_profiling_never_deleted;--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_insert;--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_kept;--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_never_deleted;--> statement-breakpoint
DROP TRIGGER initiative_targets_claim_kept;--> statement-breakpoint
DROP TRIGGER initiative_targets_claim_only;--> statement-breakpoint
DROP TRIGGER initiative_targets_not_profiling;--> statement-breakpoint
DROP TRIGGER initiative_targets_not_system_owned;--> statement-breakpoint
DROP TRIGGER initiative_targets_require_explicit_mode;--> statement-breakpoint
DROP TRIGGER initiative_standard_releases_not_profiling;--> statement-breakpoint
DROP TRIGGER assessment_targets_kind_matches_initiative;--> statement-breakpoint
DROP TRIGGER profile_versions_profiling_run;--> statement-breakpoint
-- The Assessments created for claims go with their Runs and results, which
-- are otherwise retained: the never-deleted triggers step aside for the purge
-- and come back after it, and the projection rows go as a rebuild removes
-- them, with the rebuild marker restored afterwards.
DROP TRIGGER assessments_never_deleted;--> statement-breakpoint
DROP TRIGGER assessment_targets_never_deleted;--> statement-breakpoint
DROP TRIGGER source_snapshots_never_deleted;--> statement-breakpoint
DROP TRIGGER stored_file_sets_never_deleted;--> statement-breakpoint
DROP TRIGGER repository_profiles_never_deleted;--> statement-breakpoint
DROP TRIGGER relationship_maps_never_deleted;--> statement-breakpoint
DROP TRIGGER evaluations_never_deleted;--> statement-breakpoint
DROP TRIGGER evaluation_releases_never_deleted;--> statement-breakpoint
DROP TRIGGER findings_never_deleted;--> statement-breakpoint
CREATE TEMP TABLE claim_initiatives AS SELECT id FROM initiatives WHERE claim_repository_source_id IS NOT NULL;--> statement-breakpoint
CREATE TEMP TABLE claim_assessments AS SELECT id, public_id FROM assessments WHERE initiative_id IN (SELECT id FROM claim_initiatives);--> statement-breakpoint
CREATE TEMP TABLE claim_targets AS SELECT id, public_id FROM assessment_targets WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
CREATE TEMP TABLE claim_evaluations AS SELECT id, public_id FROM evaluations WHERE initiative_id IN (SELECT id FROM claim_initiatives) OR assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
CREATE TEMP TABLE claim_projection AS SELECT rebuilding FROM projection_state WHERE id = 1;--> statement-breakpoint
UPDATE projection_state SET rebuilding = 1 WHERE id = 1;--> statement-breakpoint
DELETE FROM jobs
WHERE json_extract(payload, '$.assessment') IN (SELECT public_id FROM claim_assessments)
  OR json_extract(payload, '$.target') IN (SELECT public_id FROM claim_targets)
  OR json_extract(payload, '$.evaluation') IN (SELECT public_id FROM claim_evaluations);--> statement-breakpoint
DELETE FROM findings WHERE evaluation_id IN (SELECT id FROM claim_evaluations) OR assessment_target_id IN (SELECT id FROM claim_targets);--> statement-breakpoint
DELETE FROM evaluation_releases WHERE evaluation_id IN (SELECT id FROM claim_evaluations);--> statement-breakpoint
DELETE FROM evaluations WHERE id IN (SELECT id FROM claim_evaluations);--> statement-breakpoint
DELETE FROM dependency_facts WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM evidence_index WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM graph_edge_candidates WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM graph_edges WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM graph_nodes WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM projection_coverage WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM relationship_maps WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM repository_profiles WHERE assessment_id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM stored_file_sets WHERE assessment_target_id IN (SELECT id FROM claim_targets);--> statement-breakpoint
DELETE FROM source_snapshots WHERE assessment_target_id IN (SELECT id FROM claim_targets);--> statement-breakpoint
DELETE FROM assessment_targets WHERE id IN (SELECT id FROM claim_targets);--> statement-breakpoint
DELETE FROM assessments WHERE id IN (SELECT id FROM claim_assessments);--> statement-breakpoint
DELETE FROM initiative_standard_releases WHERE initiative_id IN (SELECT id FROM claim_initiatives);--> statement-breakpoint
DELETE FROM initiative_targets WHERE initiative_id IN (SELECT id FROM claim_initiatives);--> statement-breakpoint
DELETE FROM initiatives WHERE id IN (SELECT id FROM claim_initiatives);--> statement-breakpoint
UPDATE projection_state SET rebuilding = (SELECT rebuilding FROM claim_projection) WHERE id = 1;--> statement-breakpoint
DROP TABLE claim_initiatives;--> statement-breakpoint
DROP TABLE claim_assessments;--> statement-breakpoint
DROP TABLE claim_targets;--> statement-breakpoint
DROP TABLE claim_evaluations;--> statement-breakpoint
DROP TABLE claim_projection;--> statement-breakpoint
CREATE TRIGGER assessments_never_deleted
BEFORE DELETE ON assessments
BEGIN
  SELECT RAISE(ABORT, 'assessments: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_never_deleted
BEFORE DELETE ON assessment_targets
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_never_deleted
BEFORE DELETE ON source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER stored_file_sets_never_deleted
BEFORE DELETE ON stored_file_sets
BEGIN
  SELECT RAISE(ABORT, 'stored_file_sets: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_never_deleted
BEFORE DELETE ON repository_profiles
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER relationship_maps_never_deleted
BEFORE DELETE ON relationship_maps
BEGIN
  SELECT RAISE(ABORT, 'relationship_maps: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER evaluations_never_deleted
BEFORE DELETE ON evaluations
BEGIN
  SELECT RAISE(ABORT, 'evaluations: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER evaluation_releases_never_deleted
BEFORE DELETE ON evaluation_releases
BEGIN
  SELECT RAISE(ABORT, 'evaluation_releases: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER findings_never_deleted
BEFORE DELETE ON findings
BEGIN
  SELECT RAISE(ABORT, 'findings: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- initiatives without the claim's repository, its unique index, and its part
-- of the profiling CHECK.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_initiatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`selection_mode` text DEFAULT 'all' NOT NULL,
	`system_owned` integer DEFAULT false NOT NULL,
	`profiling` integer DEFAULT false NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "initiatives_public_id" CHECK("__new_initiatives"."public_id" GLOB 'ini_*'),
	CONSTRAINT "initiatives_name" CHECK(length(trim("__new_initiatives"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "initiatives_objective" CHECK(length("__new_initiatives"."objective") <= 2000),
	CONSTRAINT "initiatives_selection_mode" CHECK(selection_mode IN ('all', 'explicit')),
	CONSTRAINT "initiatives_system_owned" CHECK("__new_initiatives"."system_owned" IN (0, 1)),
	CONSTRAINT "initiatives_profiling" CHECK("__new_initiatives"."profiling" IN (0, 1) AND NOT ("__new_initiatives"."profiling" = 1 AND "__new_initiatives"."system_owned" = 1))
);
--> statement-breakpoint
INSERT INTO `__new_initiatives`("id", "public_id", "name", "objective", "selection_mode", "system_owned", "profiling", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "name", "objective", "selection_mode", "system_owned", "profiling", "lock_version", "created_at", "updated_at" FROM `initiatives`;--> statement-breakpoint
DROP TABLE `initiatives`;--> statement-breakpoint
ALTER TABLE `__new_initiatives` RENAME TO `initiatives`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_public_id_unique` ON `initiatives` (`public_id`);--> statement-breakpoint
-- The initiative triggers that still apply, without the claim's.
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
CREATE TRIGGER initiative_targets_not_profiling
BEFORE INSERT ON initiative_targets
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_targets: each Repository profiling Run names its own repository');
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
CREATE TRIGGER initiative_standard_releases_not_profiling
BEFORE INSERT ON initiative_standard_releases
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_standard_releases: Repository profiling Runs are not evaluated');
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
CREATE TRIGGER profile_versions_profiling_run
BEFORE INSERT ON profile_versions
WHEN (SELECT i.profiling FROM assessments a JOIN initiatives i ON i.id = a.initiative_id WHERE a.id = NEW.assessment_id) IS NOT 1
  OR NOT EXISTS (SELECT 1 FROM assessment_targets t WHERE t.assessment_id = NEW.assessment_id AND t.repository_source_id = NEW.repository_source_id)
BEGIN
	SELECT RAISE(ABORT, 'profile_versions: a version is a Repository profiling Run of its repository');
END;
--> statement-breakpoint
-- Every row the rebuild copied, and every row the purge left, still points
-- at what it pointed at before; a violation fails the migration, and the
-- whole run rolls back.
CREATE TEMP TABLE ownership_removed_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO ownership_removed_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE ownership_removed_foreign_keys;
