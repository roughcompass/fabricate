-- Salt Patterns is removed (prune-and-consolidate-code, design decision 5),
-- as 0036 removed the DE Web initiative: its initiative, Runs, and their
-- results go, and with them template targets, their stored files, and the
-- initiative flag that marked it. Only the removed Prototypes started its
-- Runs. Nothing of it is kept; this is a POC.
--
-- Every trigger that reads a table rebuilt below steps aside first, since
-- renaming a rebuilt table fails while any of them refers to the dropped one,
-- and so do the never-deleted guards, for the purge. Those that still apply
-- come back after, without the template and Salt Patterns parts.
DROP TRIGGER assessment_targets_created_with_assessment;
--> statement-breakpoint
DROP TRIGGER assessment_targets_initial_state;
--> statement-breakpoint
DROP TRIGGER assessment_targets_kind_matches_initiative;
--> statement-breakpoint
DROP TRIGGER assessment_targets_scope_immutable;
--> statement-breakpoint
DROP TRIGGER assessment_targets_state_transitions;
--> statement-breakpoint
DROP TRIGGER assessment_targets_terminal_frozen;
--> statement-breakpoint
DROP TRIGGER findings_match_pinned_release;
--> statement-breakpoint
DROP TRIGGER initiative_standard_releases_not_profiling;
--> statement-breakpoint
DROP TRIGGER initiative_targets_not_profiling;
--> statement-breakpoint
DROP TRIGGER initiative_targets_not_system_owned;
--> statement-breakpoint
DROP TRIGGER initiative_targets_require_explicit_mode;
--> statement-breakpoint
DROP TRIGGER initiatives_all_has_no_targets;
--> statement-breakpoint
DROP TRIGGER initiatives_identity_immutable;
--> statement-breakpoint
DROP TRIGGER initiatives_profiling_insert;
--> statement-breakpoint
DROP TRIGGER initiatives_profiling_kept;
--> statement-breakpoint
DROP TRIGGER initiatives_profiling_never_deleted;
--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_insert;
--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_kept;
--> statement-breakpoint
DROP TRIGGER initiatives_system_owned_never_deleted;
--> statement-breakpoint
DROP TRIGGER profile_versions_profiling_run;
--> statement-breakpoint
DROP TRIGGER repository_profiles_match_snapshot;
--> statement-breakpoint
DROP TRIGGER source_snapshots_immutable;
--> statement-breakpoint
DROP TRIGGER source_snapshots_match_target;
--> statement-breakpoint
DROP TRIGGER stored_file_sets_immutable;
--> statement-breakpoint
DROP TRIGGER stored_file_sets_match_target;
--> statement-breakpoint
DROP TRIGGER assessments_never_deleted;
--> statement-breakpoint
DROP TRIGGER assessment_targets_never_deleted;
--> statement-breakpoint
DROP TRIGGER source_snapshots_never_deleted;
--> statement-breakpoint
DROP TRIGGER stored_file_sets_never_deleted;
--> statement-breakpoint
DROP TRIGGER repository_profiles_never_deleted;
--> statement-breakpoint
DROP TRIGGER relationship_maps_never_deleted;
--> statement-breakpoint
DROP TRIGGER evaluations_never_deleted;
--> statement-breakpoint
DROP TRIGGER evaluation_releases_never_deleted;
--> statement-breakpoint
DROP TRIGGER findings_never_deleted;
--> statement-breakpoint
-- The Salt Patterns initiative goes with its Runs and their results; the
-- projection rows go as a rebuild removes them, with the rebuild marker
-- restored afterwards.
CREATE TEMP TABLE salt_initiatives AS SELECT id FROM initiatives WHERE system_owned = 1;
--> statement-breakpoint
CREATE TEMP TABLE salt_assessments AS SELECT id, public_id FROM assessments WHERE initiative_id IN (SELECT id FROM salt_initiatives);
--> statement-breakpoint
CREATE TEMP TABLE salt_targets AS SELECT id, public_id FROM assessment_targets WHERE assessment_id IN (SELECT id FROM salt_assessments) OR kind = 'template';
--> statement-breakpoint
CREATE TEMP TABLE salt_evaluations AS SELECT id, public_id FROM evaluations WHERE initiative_id IN (SELECT id FROM salt_initiatives) OR assessment_id IN (SELECT id FROM salt_assessments);
--> statement-breakpoint
CREATE TEMP TABLE salt_projection AS SELECT rebuilding FROM projection_state WHERE id = 1;
--> statement-breakpoint
UPDATE projection_state SET rebuilding = 1 WHERE id = 1;
--> statement-breakpoint
DELETE FROM jobs
WHERE json_extract(payload, '$.assessment') IN (SELECT public_id FROM salt_assessments)
  OR json_extract(payload, '$.target') IN (SELECT public_id FROM salt_targets)
  OR json_extract(payload, '$.evaluation') IN (SELECT public_id FROM salt_evaluations);
--> statement-breakpoint
DELETE FROM findings WHERE evaluation_id IN (SELECT id FROM salt_evaluations) OR assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM evaluation_releases WHERE evaluation_id IN (SELECT id FROM salt_evaluations);
--> statement-breakpoint
DELETE FROM evaluations WHERE id IN (SELECT id FROM salt_evaluations);
--> statement-breakpoint
DELETE FROM dependency_facts WHERE assessment_id IN (SELECT id FROM salt_assessments) OR assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM evidence_index WHERE assessment_id IN (SELECT id FROM salt_assessments) OR assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM graph_edge_candidates WHERE assessment_id IN (SELECT id FROM salt_assessments);
--> statement-breakpoint
DELETE FROM graph_edges WHERE assessment_id IN (SELECT id FROM salt_assessments);
--> statement-breakpoint
DELETE FROM graph_nodes WHERE assessment_id IN (SELECT id FROM salt_assessments) OR assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM projection_coverage WHERE assessment_id IN (SELECT id FROM salt_assessments) OR assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM relationship_maps WHERE assessment_id IN (SELECT id FROM salt_assessments);
--> statement-breakpoint
DELETE FROM repository_profiles WHERE assessment_id IN (SELECT id FROM salt_assessments) OR assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM source_snapshots WHERE assessment_target_id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM assessment_targets WHERE id IN (SELECT id FROM salt_targets);
--> statement-breakpoint
DELETE FROM assessments WHERE id IN (SELECT id FROM salt_assessments);
--> statement-breakpoint
DELETE FROM initiative_standard_releases WHERE initiative_id IN (SELECT id FROM salt_initiatives);
--> statement-breakpoint
DELETE FROM initiative_targets WHERE initiative_id IN (SELECT id FROM salt_initiatives);
--> statement-breakpoint
DELETE FROM initiatives WHERE id IN (SELECT id FROM salt_initiatives);
--> statement-breakpoint
UPDATE projection_state SET rebuilding = (SELECT rebuilding FROM salt_projection) WHERE id = 1;
--> statement-breakpoint
DROP TABLE salt_initiatives;
--> statement-breakpoint
DROP TABLE salt_assessments;
--> statement-breakpoint
DROP TABLE salt_targets;
--> statement-breakpoint
DROP TABLE salt_evaluations;
--> statement-breakpoint
DROP TABLE salt_projection;
--> statement-breakpoint
-- Stored files, initiatives without the Salt Patterns flag, and assessment
-- targets and snapshots that are always a catalog repository at a commit.
DROP TABLE `stored_file_sets`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_initiatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`selection_mode` text DEFAULT 'all' NOT NULL,
	`profiling` integer DEFAULT false NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "initiatives_public_id" CHECK("__new_initiatives"."public_id" GLOB 'ini_*'),
	CONSTRAINT "initiatives_name" CHECK(length(trim("__new_initiatives"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "initiatives_objective" CHECK(length("__new_initiatives"."objective") <= 2000),
	CONSTRAINT "initiatives_selection_mode" CHECK(selection_mode IN ('all', 'explicit')),
	CONSTRAINT "initiatives_profiling" CHECK("__new_initiatives"."profiling" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_initiatives`("id", "public_id", "name", "objective", "selection_mode", "profiling", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "name", "objective", "selection_mode", "profiling", "lock_version", "created_at", "updated_at" FROM `initiatives`;--> statement-breakpoint
DROP TABLE `initiatives`;--> statement-breakpoint
ALTER TABLE `__new_initiatives` RENAME TO `initiatives`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_public_id_unique` ON `initiatives` (`public_id`);--> statement-breakpoint
CREATE TABLE `__new_assessment_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_id` integer NOT NULL,
	`repository_source_id` integer NOT NULL,
	`position` integer NOT NULL,
	`source_public_id` text NOT NULL,
	`source_name` text NOT NULL,
	`clone_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`git_ref` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`started_at` integer,
	`finished_at` integer,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assessment_targets_public_id" CHECK("__new_assessment_targets"."public_id" GLOB 'tgt_*'),
	CONSTRAINT "assessment_targets_position_range" CHECK("__new_assessment_targets"."position" >= 0),
	CONSTRAINT "assessment_targets_state" CHECK(state IN ('pending', 'acquiring', 'analyzing', 'complete', 'failed', 'canceled')),
	CONSTRAINT "assessment_targets_failure_code" CHECK(("__new_assessment_targets"."failure_code" IS NOT NULL) = ("__new_assessment_targets"."state" = 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_assessment_targets`("id", "public_id", "assessment_id", "repository_source_id", "position", "source_public_id", "source_name", "clone_url", "canonical_url", "git_ref", "state", "failure_code", "failure_message", "started_at", "finished_at", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "assessment_id", "repository_source_id", "position", "source_public_id", "source_name", "clone_url", "canonical_url", "git_ref", "state", "failure_code", "failure_message", "started_at", "finished_at", "lock_version", "created_at", "updated_at" FROM `assessment_targets`;--> statement-breakpoint
DROP TABLE `assessment_targets`;--> statement-breakpoint
ALTER TABLE `__new_assessment_targets` RENAME TO `assessment_targets`;--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_public_id_unique` ON `assessment_targets` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_position` ON `assessment_targets` (`assessment_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_source` ON `assessment_targets` (`assessment_id`,`repository_source_id`);--> statement-breakpoint
CREATE INDEX `assessment_targets_repository_source` ON `assessment_targets` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `__new_source_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`repository_source_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`tree_sha` text NOT NULL,
	`ref_kind` text NOT NULL,
	`resolved_ref` text NOT NULL,
	`internal_ref` text NOT NULL,
	`acquisition_metadata` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assessment_target_id`) REFERENCES `assessment_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "source_snapshots_public_id" CHECK("__new_source_snapshots"."public_id" GLOB 'snp_*'),
	CONSTRAINT "source_snapshots_object_ids" CHECK(length("__new_source_snapshots"."commit_sha") = 40 AND "__new_source_snapshots"."commit_sha" NOT GLOB '*[^0-9a-f]*' AND length("__new_source_snapshots"."tree_sha") = 40 AND "__new_source_snapshots"."tree_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "source_snapshots_ref_kind" CHECK(ref_kind IN ('default_branch', 'branch', 'tag', 'commit')),
	CONSTRAINT "source_snapshots_internal_ref" CHECK("__new_source_snapshots"."internal_ref" = 'refs/fabricate/snapshots/' || "__new_source_snapshots"."public_id")
);
--> statement-breakpoint
INSERT INTO `__new_source_snapshots`("id", "public_id", "assessment_target_id", "repository_source_id", "commit_sha", "tree_sha", "ref_kind", "resolved_ref", "internal_ref", "acquisition_metadata", "acquired_at", "created_at") SELECT "id", "public_id", "assessment_target_id", "repository_source_id", "commit_sha", "tree_sha", "ref_kind", "resolved_ref", "internal_ref", "acquisition_metadata", "acquired_at", "created_at" FROM `source_snapshots`;--> statement-breakpoint
DROP TABLE `source_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_source_snapshots` RENAME TO `source_snapshots`;--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_public_id_unique` ON `source_snapshots` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_assessment_target_id_unique` ON `source_snapshots` (`assessment_target_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_internal_ref_unique` ON `source_snapshots` (`internal_ref`);--> statement-breakpoint
CREATE INDEX `source_snapshots_commit` ON `source_snapshots` (`commit_sha`);--> statement-breakpoint
CREATE INDEX `source_snapshots_repository_source` ON `source_snapshots` (`repository_source_id`);--> statement-breakpoint
-- The guards and rules that still apply.
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
CREATE TRIGGER assessment_targets_created_with_assessment
BEFORE INSERT ON assessment_targets
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) IS NOT 'queued'
  OR NEW.created_at IS NOT (SELECT created_at FROM assessments WHERE id = NEW.assessment_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope is frozen when the assessment is created');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_initial_state
BEFORE INSERT ON assessment_targets
WHEN NEW.state IS NOT 'pending'
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: new targets start pending');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_scope_immutable
BEFORE UPDATE ON assessment_targets
WHEN NEW.public_id IS NOT OLD.public_id
  OR NEW.assessment_id IS NOT OLD.assessment_id
  OR NEW.repository_source_id IS NOT OLD.repository_source_id
  OR NEW.position IS NOT OLD.position
  OR NEW.source_public_id IS NOT OLD.source_public_id
  OR NEW.source_name IS NOT OLD.source_name
  OR NEW.clone_url IS NOT OLD.clone_url
  OR NEW.canonical_url IS NOT OLD.canonical_url
  OR NEW.git_ref IS NOT OLD.git_ref
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope snapshot cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_state_transitions
BEFORE UPDATE OF state ON assessment_targets
WHEN NEW.state IS NOT OLD.state AND OLD.state NOT IN ('complete', 'failed', 'canceled') AND NOT (
    (OLD.state = 'pending' AND NEW.state IN ('acquiring', 'canceled', 'failed')) OR
    (OLD.state = 'acquiring' AND NEW.state IN ('analyzing', 'canceled', 'failed')) OR
    (OLD.state = 'analyzing' AND NEW.state IN ('complete', 'canceled', 'failed'))
  )
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: state transition is not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_terminal_frozen
BEFORE UPDATE ON assessment_targets
WHEN OLD.state IN ('complete', 'failed', 'canceled')
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: a terminal target cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER findings_match_pinned_release
BEFORE INSERT ON findings
WHEN NEW.evaluation_id IS NOT (SELECT evaluation_id FROM evaluation_releases WHERE id = NEW.evaluation_release_id)
  OR NEW.standard_release_id IS NOT (SELECT standard_release_id FROM evaluation_releases WHERE id = NEW.evaluation_release_id)
  OR (NEW.assessment_target_id IS NOT NULL AND (SELECT assessment_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
      IS NOT (SELECT assessment_id FROM evaluations WHERE id = NEW.evaluation_id))
BEGIN
  SELECT RAISE(ABORT, 'findings: a Finding must match its pinned Release and Assessment');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_standard_releases_not_profiling
BEFORE INSERT ON initiative_standard_releases
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_standard_releases: Repository profiling Runs are not evaluated');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_not_profiling
BEFORE INSERT ON initiative_targets
WHEN (SELECT profiling FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_targets: each Repository profiling Run names its own repository');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_require_explicit_mode
BEFORE INSERT ON initiative_targets
WHEN (SELECT selection_mode FROM initiatives WHERE id = NEW.initiative_id) <> 'explicit'
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: only explicit initiatives select sources');
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
CREATE TRIGGER profile_versions_profiling_run
BEFORE INSERT ON profile_versions
WHEN (SELECT i.profiling FROM assessments a JOIN initiatives i ON i.id = a.initiative_id WHERE a.id = NEW.assessment_id) IS NOT 1
  OR NOT EXISTS (SELECT 1 FROM assessment_targets t WHERE t.assessment_id = NEW.assessment_id AND t.repository_source_id = NEW.repository_source_id)
BEGIN
	SELECT RAISE(ABORT, 'profile_versions: a version is a Repository profiling Run of its repository');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_match_snapshot
BEFORE INSERT ON repository_profiles
WHEN NEW.assessment_target_id IS NOT (SELECT assessment_target_id FROM source_snapshots WHERE id = NEW.source_snapshot_id)
  OR NEW.assessment_id IS NOT (SELECT assessment_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'analyzing'
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: a Profile is written for its analyzing target and pinned snapshot');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_immutable
BEFORE UPDATE ON source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_match_target
BEFORE INSERT ON source_snapshots
WHEN NEW.repository_source_id IS NOT (SELECT repository_source_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'acquiring'
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: a snapshot is recorded for its acquiring target');
END;
--> statement-breakpoint
-- Every row the rebuilds copied, and every row the purge left, still points
-- at what it pointed at before; a violation fails the migration, and the
-- whole run rolls back.
CREATE TEMP TABLE salt_patterns_removed_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO salt_patterns_removed_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE salt_patterns_removed_foreign_keys;
