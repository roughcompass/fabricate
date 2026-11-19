-- establish-frontend-registry, design decision 6: a survey's recipe includes the
-- Reference Catalog entries it was surveyed against, recorded when it succeeds,
-- and a survey can run because an entry its Repository's current survey used
-- changed (trigger 'catalog'). Widening the trigger check rebuilds the table, so
-- the triggers that read surveys are dropped first and recreated after, and the
-- key's uniqueness now covers only surveys on their way or failed: successful
-- surveys of one commit and recipe differ in their entries.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TRIGGER assessment_targets_survey_matches;
--> statement-breakpoint
DROP TRIGGER preview_preparations_survey_matches;
--> statement-breakpoint
DROP TRIGGER repository_profiles_written_by_survey;
--> statement-breakpoint
DROP TRIGGER repository_sources_current_survey;
--> statement-breakpoint
CREATE TABLE `__new_surveys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`repository_source_id` integer NOT NULL,
	`number` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`tree_sha` text,
	`internal_ref` text,
	`reference` text NOT NULL,
	`from_configured_reference` integer NOT NULL,
	`resolved_at` integer NOT NULL,
	`surveyor_release` text NOT NULL,
	`configuration_digest` text NOT NULL,
	`profile_schema_version` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`trigger` text NOT NULL,
	`catalog` text,
	`catalog_digest` text,
	`requested_by_assessment_id` integer,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "surveys_public_id" CHECK("__new_surveys"."public_id" GLOB 'srv_*'),
	CONSTRAINT "surveys_number_range" CHECK("__new_surveys"."number" >= 1),
	CONSTRAINT "surveys_commit_sha" CHECK(length("__new_surveys"."commit_sha") = 40 AND "__new_surveys"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "surveys_tree_sha" CHECK("__new_surveys"."tree_sha" IS NULL OR (length("__new_surveys"."tree_sha") = 40 AND "__new_surveys"."tree_sha" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "surveys_internal_ref" CHECK("__new_surveys"."internal_ref" IS NULL OR "__new_surveys"."internal_ref" GLOB 'refs/fabricate/snapshots/*' OR "__new_surveys"."internal_ref" = 'refs/fabricate/previews/' || "__new_surveys"."commit_sha"),
	CONSTRAINT "surveys_reference" CHECK(length("__new_surveys"."reference") BETWEEN 1 AND 255),
	CONSTRAINT "surveys_configuration_digest" CHECK(length("__new_surveys"."configuration_digest") = 64),
	CONSTRAINT "surveys_profile_schema_version" CHECK("__new_surveys"."profile_schema_version" >= 1),
	CONSTRAINT "surveys_state" CHECK(state IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "surveys_trigger" CHECK(trigger IN ('added', 'edited', 'commit', 'recipe', 'catalog', 'manual', 'run', 'preview')),
	CONSTRAINT "surveys_attempts" CHECK("__new_surveys"."attempts" >= 0),
	CONSTRAINT "surveys_failure" CHECK("__new_surveys"."state" <> 'failed' OR "__new_surveys"."failure_code" IS NOT NULL),
	CONSTRAINT "surveys_catalog" CHECK(("__new_surveys"."catalog" IS NULL) = ("__new_surveys"."catalog_digest" IS NULL) AND ("__new_surveys"."catalog" IS NULL OR ("__new_surveys"."state" = 'succeeded' AND json_valid("__new_surveys"."catalog") AND json_type("__new_surveys"."catalog") = 'object' AND length("__new_surveys"."catalog_digest") = 64))),
	CONSTRAINT "surveys_finished" CHECK(("__new_surveys"."finished_at" IS NOT NULL) = ("__new_surveys"."state" IN ('succeeded', 'failed'))),
	CONSTRAINT "surveys_pinned" CHECK("__new_surveys"."state" <> 'succeeded' OR "__new_surveys"."internal_ref" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_surveys`("id", "public_id", "repository_source_id", "number", "commit_sha", "tree_sha", "internal_ref", "reference", "from_configured_reference", "resolved_at", "surveyor_release", "configuration_digest", "profile_schema_version", "state", "attempts", "failure_code", "failure_message", "trigger", "catalog", "catalog_digest", "requested_by_assessment_id", "created_at", "finished_at") SELECT "id", "public_id", "repository_source_id", "number", "commit_sha", "tree_sha", "internal_ref", "reference", "from_configured_reference", "resolved_at", "surveyor_release", "configuration_digest", "profile_schema_version", "state", "attempts", "failure_code", "failure_message", "trigger", NULL, NULL, "requested_by_assessment_id", "created_at", "finished_at" FROM `surveys`;
--> statement-breakpoint
DROP TABLE `surveys`;
--> statement-breakpoint
ALTER TABLE `__new_surveys` RENAME TO `surveys`;
--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_public_id_unique` ON `surveys` (`public_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_open_key` ON `surveys` (`repository_source_id`,`commit_sha`,`surveyor_release`,`configuration_digest`,`profile_schema_version`) WHERE state <> 'succeeded';
--> statement-breakpoint
CREATE INDEX `surveys_commit` ON `surveys` (`repository_source_id`,`commit_sha`);
--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_number` ON `surveys` (`repository_source_id`,`number`);
--> statement-breakpoint
CREATE INDEX `surveys_state` ON `surveys` (`state`);
--> statement-breakpoint
CREATE TRIGGER surveys_identity_fixed
BEFORE UPDATE ON surveys
WHEN NEW.public_id IS NOT OLD.public_id
  OR NEW.repository_source_id IS NOT OLD.repository_source_id
  OR NEW.number IS NOT OLD.number
  OR NEW.commit_sha IS NOT OLD.commit_sha
  OR NEW.reference IS NOT OLD.reference
  OR NEW.from_configured_reference IS NOT OLD.from_configured_reference
  OR NEW.resolved_at IS NOT OLD.resolved_at
  OR NEW.surveyor_release IS NOT OLD.surveyor_release
  OR NEW.configuration_digest IS NOT OLD.configuration_digest
  OR NEW.profile_schema_version IS NOT OLD.profile_schema_version
  OR NEW.trigger IS NOT OLD.trigger
  OR NEW.requested_by_assessment_id IS NOT OLD.requested_by_assessment_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'surveys: a survey keeps its Repository, number, commit, and recipe');
END;
--> statement-breakpoint
CREATE TRIGGER surveys_pin_fixed
BEFORE UPDATE ON surveys
WHEN (OLD.tree_sha IS NOT NULL AND NEW.tree_sha IS NOT OLD.tree_sha)
  OR (OLD.internal_ref IS NOT NULL AND NEW.internal_ref IS NOT OLD.internal_ref)
BEGIN
  SELECT RAISE(ABORT, 'surveys: a pinned commit stays pinned');
END;
--> statement-breakpoint
CREATE TRIGGER surveys_numbered
BEFORE INSERT ON surveys
WHEN NEW.number IS NOT (SELECT COALESCE(MAX(number), 0) + 1 FROM surveys WHERE repository_source_id = NEW.repository_source_id)
BEGIN
  SELECT RAISE(ABORT, 'surveys: a survey takes its Repository''s next number');
END;
--> statement-breakpoint
CREATE TRIGGER surveys_never_deleted
BEFORE DELETE ON surveys
BEGIN
  SELECT RAISE(ABORT, 'surveys: surveys are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER surveys_initial_state
BEFORE INSERT ON surveys
WHEN NEW.state IS NOT 'queued'
BEGIN
  SELECT RAISE(ABORT, 'surveys: new surveys start queued');
END;
--> statement-breakpoint
CREATE TRIGGER surveys_terminal_frozen
BEFORE UPDATE ON surveys
WHEN OLD.state IN ('succeeded')
BEGIN
  SELECT RAISE(ABORT, 'surveys: a terminal survey cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER surveys_state_transitions
BEFORE UPDATE OF state ON surveys
WHEN NEW.state IS NOT OLD.state AND OLD.state NOT IN ('succeeded') AND NOT (
    (OLD.state = 'queued' AND NEW.state IN ('running', 'failed')) OR
    (OLD.state = 'running' AND NEW.state IN ('succeeded', 'failed')) OR
    (OLD.state = 'failed' AND NEW.state IN ('queued'))
  )
BEGIN
  SELECT RAISE(ABORT, 'surveys: state transition is not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_survey_matches
BEFORE UPDATE OF survey_id ON assessment_targets
WHEN NEW.survey_id IS NOT NULL AND (SELECT repository_source_id FROM surveys WHERE id = NEW.survey_id) IS NOT NEW.repository_source_id
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: a target links a survey of its own Repository');
END;
--> statement-breakpoint
CREATE TRIGGER preview_preparations_survey_matches
BEFORE UPDATE OF survey_id ON preview_preparations
WHEN NEW.survey_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM surveys s WHERE s.id = NEW.survey_id AND s.repository_source_id = NEW.repository_source_id AND s.commit_sha = NEW.commit_sha
)
BEGIN
  SELECT RAISE(ABORT, 'preview_preparations: a preparation links a survey of its Repository and commit');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_written_by_survey
BEFORE INSERT ON repository_profiles
WHEN (SELECT state FROM surveys WHERE id = NEW.survey_id) IS NOT 'running'
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: a Profile is written by its running survey');
END;
--> statement-breakpoint
CREATE TRIGGER repository_sources_current_survey
BEFORE UPDATE OF current_survey_id ON repository_sources
WHEN NEW.current_survey_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM surveys s WHERE s.id = NEW.current_survey_id AND s.repository_source_id = NEW.id AND s.state = 'succeeded' AND s.commit_sha IS NEW.configured_commit
)
BEGIN
  SELECT RAISE(ABORT, 'repository_sources: the current survey is a successful survey of the commit the configured reference names');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- The rebuilt table keeps every reference to it intact.
CREATE TEMP TABLE survey_catalog_recipes_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO survey_catalog_recipes_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE survey_catalog_recipes_foreign_keys;
