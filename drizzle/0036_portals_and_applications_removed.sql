-- Portals and Applications are removed: Create Portal, Add application and
-- Create Application, Runtime Configuration's experience editor and
-- configuration pages, and the DE Web initiative that assessed each
-- registered Application's repository. Ownership keeps its applications and
-- portals as claims and the DE Console describe them; only what registration
-- and onboarding added goes. Nothing of the dropped history is kept; this is
-- a POC. The demo's deployments go in 0037, a demo migration, so the product
-- schema still builds without the demo tables.
--
-- Triggers on the tables rebuilt below, and the DE Web initiative's. The
-- ones that still apply come back after the rebuilds.
DROP TRIGGER portals_identity;--> statement-breakpoint
DROP TRIGGER portals_never_deleted;--> statement-breakpoint
DROP TRIGGER portals_platform_and_slug_fixed;--> statement-breakpoint
DROP TRIGGER applications_identity;--> statement-breakpoint
DROP TRIGGER applications_never_deleted;--> statement-breakpoint
DROP TRIGGER applications_registration_fixed;--> statement-breakpoint
DROP TRIGGER initiatives_de_web_insert;--> statement-breakpoint
DROP TRIGGER initiatives_de_web_kept;--> statement-breakpoint
DROP TRIGGER initiatives_de_web_never_deleted;--> statement-breakpoint
DROP TRIGGER initiative_targets_not_de_web;--> statement-breakpoint
-- Registered Applications, and the Portals that were onboarded, go unless an
-- ownership claim or the DE Console names them; a Portal named only in a
-- claim stays. migrateDatabase turns foreign key enforcement off for the
-- run, so the references are checked here.
DELETE FROM applications
WHERE repository_source_id IS NOT NULL
  AND id NOT IN (SELECT subject_application_id FROM ownership_assertions WHERE subject_application_id IS NOT NULL)
  AND id NOT IN (SELECT value_application_id FROM ownership_assertions WHERE value_application_id IS NOT NULL)
  AND id NOT IN (SELECT application_id FROM de_console_links);--> statement-breakpoint
DELETE FROM portals
WHERE (platform IS NOT NULL OR slug IS NOT NULL
    OR id IN (SELECT portal_id FROM onboarding_events WHERE portal_id IS NOT NULL)
    OR id IN (SELECT portal_id FROM portal_menu_items)
    OR id IN (SELECT portal_id FROM portal_experience_versions))
  AND id NOT IN (SELECT subject_portal_id FROM ownership_assertions WHERE subject_portal_id IS NOT NULL)
  AND id NOT IN (SELECT value_portal_id FROM ownership_assertions WHERE value_portal_id IS NOT NULL);--> statement-breakpoint
DROP TABLE `application_assessments`;--> statement-breakpoint
DROP TABLE `onboarding_events`;--> statement-breakpoint
DROP TABLE `portal_experience_versions`;--> statement-breakpoint
DROP TABLE `portal_menu_items`;--> statement-breakpoint
-- What 0032 staged for the menu backfill, which is gone too.
DROP TABLE IF EXISTS `_carried_menu_groups`;--> statement-breakpoint
DROP TABLE IF EXISTS `_carried_menu_routes`;--> statement-breakpoint
DROP TABLE IF EXISTS `_carried_onboarded_portals`;--> statement-breakpoint
-- The DE Web initiative goes with its Runs and their results, which are
-- otherwise retained: the never-deleted triggers step aside for the purge
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
CREATE TEMP TABLE de_web_initiatives AS SELECT id FROM initiatives WHERE de_web = 1;--> statement-breakpoint
CREATE TEMP TABLE de_web_assessments AS SELECT id, public_id FROM assessments WHERE initiative_id IN (SELECT id FROM de_web_initiatives);--> statement-breakpoint
CREATE TEMP TABLE de_web_targets AS SELECT id, public_id FROM assessment_targets WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
CREATE TEMP TABLE de_web_evaluations AS SELECT id, public_id FROM evaluations WHERE initiative_id IN (SELECT id FROM de_web_initiatives) OR assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
CREATE TEMP TABLE de_web_projection AS SELECT rebuilding FROM projection_state WHERE id = 1;--> statement-breakpoint
UPDATE projection_state SET rebuilding = 1 WHERE id = 1;--> statement-breakpoint
DELETE FROM jobs
WHERE json_extract(payload, '$.assessment') IN (SELECT public_id FROM de_web_assessments)
  OR json_extract(payload, '$.target') IN (SELECT public_id FROM de_web_targets)
  OR json_extract(payload, '$.evaluation') IN (SELECT public_id FROM de_web_evaluations);--> statement-breakpoint
DELETE FROM findings WHERE evaluation_id IN (SELECT id FROM de_web_evaluations) OR assessment_target_id IN (SELECT id FROM de_web_targets);--> statement-breakpoint
DELETE FROM evaluation_releases WHERE evaluation_id IN (SELECT id FROM de_web_evaluations);--> statement-breakpoint
DELETE FROM evaluations WHERE id IN (SELECT id FROM de_web_evaluations);--> statement-breakpoint
DELETE FROM concept_classifications WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM dependency_facts WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM evidence_index WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM graph_edge_candidates WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM graph_edges WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM graph_nodes WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM projection_coverage WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM relationship_maps WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM repository_profiles WHERE assessment_id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM stored_file_sets WHERE assessment_target_id IN (SELECT id FROM de_web_targets);--> statement-breakpoint
DELETE FROM source_snapshots WHERE assessment_target_id IN (SELECT id FROM de_web_targets);--> statement-breakpoint
DELETE FROM assessment_targets WHERE id IN (SELECT id FROM de_web_targets);--> statement-breakpoint
DELETE FROM assessments WHERE id IN (SELECT id FROM de_web_assessments);--> statement-breakpoint
DELETE FROM initiative_standard_releases WHERE initiative_id IN (SELECT id FROM de_web_initiatives);--> statement-breakpoint
DELETE FROM initiative_targets WHERE initiative_id IN (SELECT id FROM de_web_initiatives);--> statement-breakpoint
DELETE FROM initiatives WHERE id IN (SELECT id FROM de_web_initiatives);--> statement-breakpoint
UPDATE projection_state SET rebuilding = (SELECT rebuilding FROM de_web_projection) WHERE id = 1;--> statement-breakpoint
DROP TABLE de_web_initiatives;--> statement-breakpoint
DROP TABLE de_web_assessments;--> statement-breakpoint
DROP TABLE de_web_targets;--> statement-breakpoint
DROP TABLE de_web_evaluations;--> statement-breakpoint
DROP TABLE de_web_projection;--> statement-breakpoint
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
-- The column goes in place rather than by rebuilding initiatives, which
-- would drop its triggers and the ones on other tables that read it. Its
-- CHECK belongs to the column, so it goes too.
ALTER TABLE `initiatives` DROP COLUMN `de_web`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`seal_id` text,
	`name` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "applications_public_id" CHECK("__new_applications"."public_id" GLOB 'sea_*' OR "__new_applications"."public_id" GLOB 'wap_*'),
	CONSTRAINT "applications_seal_id" CHECK("__new_applications"."seal_id" IS NULL OR (length("__new_applications"."seal_id") BETWEEN 1 AND 64 AND "__new_applications"."seal_id" = trim("__new_applications"."seal_id"))),
	CONSTRAINT "applications_name" CHECK("__new_applications"."name" IS NULL OR length(trim("__new_applications"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "public_id", "seal_id", "name", "created_at") SELECT "id", "public_id", "seal_id", "name", "created_at" FROM `applications`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_public_id_unique` ON `applications` (`public_id`);--> statement-breakpoint
CREATE INDEX `applications_seal_id` ON `applications` (`seal_id`);--> statement-breakpoint
CREATE INDEX `applications_name` ON `applications` (`name`);--> statement-breakpoint
CREATE TABLE `__new_portals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`label` text NOT NULL,
	`label_key` text NOT NULL,
	`concept_key` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "portals_public_id" CHECK("__new_portals"."public_id" GLOB 'ptl_*'),
	CONSTRAINT "portals_label" CHECK(length(trim("__new_portals"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "portals_concept" CHECK("__new_portals"."concept_key" IS NULL OR "__new_portals"."concept_key" GLOB 'portal/*')
);
--> statement-breakpoint
INSERT INTO `__new_portals`("id", "public_id", "label", "label_key", "concept_key", "created_at") SELECT "id", "public_id", "label", "label_key", "concept_key", "created_at" FROM `portals`;--> statement-breakpoint
DROP TABLE `portals`;--> statement-breakpoint
ALTER TABLE `__new_portals` RENAME TO `portals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `portals_public_id_unique` ON `portals` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portals_label_key_unique` ON `portals` (`label_key`);--> statement-breakpoint
CREATE TRIGGER portals_identity
BEFORE UPDATE ON portals
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.concept_key IS NOT NULL AND NEW.concept_key IS NOT OLD.concept_key)
BEGIN
  SELECT RAISE(ABORT, 'portals: a portal keeps its identity, and its concept once approved');
END;
--> statement-breakpoint
CREATE TRIGGER portals_never_deleted
BEFORE DELETE ON portals
BEGIN
  SELECT RAISE(ABORT, 'portals: ownership records are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER applications_identity
BEFORE UPDATE ON applications
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'applications: an application keeps its public ID and creation time');
END;
--> statement-breakpoint
CREATE TRIGGER applications_never_deleted
BEFORE DELETE ON applications
BEGIN
	SELECT RAISE(ABORT, 'applications: ownership records are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Every row the rebuilds copied, and every row the purges left, still points
-- at what it pointed at before; a violation fails the migration, and the
-- whole run rolls back.
CREATE TEMP TABLE portals_and_applications_removed_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO portals_and_applications_removed_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE portals_and_applications_removed_foreign_keys;
