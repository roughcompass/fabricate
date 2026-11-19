-- One survey per repository, commit, and recipe (unify-surveys, design
-- decision 8). Snapshots and their Profiles become surveys, numbered per
-- Repository in creation order; duplicates of a key keep the earliest
-- Profile. Run targets link their survey and keep how their reference
-- resolved. The hidden Repository profiling initiative goes with its Runs and
-- their one-repository maps; its Profiles stay, attached to their surveys. A
-- preview's own Profile becomes a preview survey. The projection is recreated
-- empty in its new shape: run `npm run projection:rebuild` after migrating.
--
-- Every trigger that reads a rebuilt table steps aside first, as do the
-- never-deleted guards the purge passes; those that still apply come back at
-- the end, and the foreign keys are checked before it commits.
DROP TRIGGER assessment_targets_created_with_assessment;
--> statement-breakpoint
DROP TRIGGER assessment_targets_initial_state;
--> statement-breakpoint
DROP TRIGGER assessment_targets_scope_immutable;
--> statement-breakpoint
DROP TRIGGER assessment_targets_state_transitions;
--> statement-breakpoint
DROP TRIGGER assessment_targets_terminal_frozen;
--> statement-breakpoint
DROP TRIGGER assessment_targets_never_deleted;
--> statement-breakpoint
DROP TRIGGER findings_match_pinned_release;
--> statement-breakpoint
DROP TRIGGER initiative_standard_releases_not_profiling;
--> statement-breakpoint
DROP TRIGGER initiative_targets_not_profiling;
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
DROP TRIGGER preview_builds_prepared;
--> statement-breakpoint
DROP TRIGGER preview_preparations_identity_fixed;
--> statement-breakpoint
DROP TRIGGER profile_versions_immutable;
--> statement-breakpoint
DROP TRIGGER profile_versions_never_deleted;
--> statement-breakpoint
DROP TRIGGER profile_versions_profiling_run;
--> statement-breakpoint
DROP TRIGGER repository_profiles_immutable;
--> statement-breakpoint
DROP TRIGGER repository_profiles_match_snapshot;
--> statement-breakpoint
DROP TRIGGER repository_profiles_never_deleted;
--> statement-breakpoint
DROP TRIGGER source_snapshots_immutable;
--> statement-breakpoint
DROP TRIGGER source_snapshots_match_target;
--> statement-breakpoint
DROP TRIGGER source_snapshots_never_deleted;
--> statement-breakpoint
DROP TRIGGER assessments_never_deleted;
--> statement-breakpoint
DROP TRIGGER relationship_maps_never_deleted;
--> statement-breakpoint
CREATE TABLE `surveys` (
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
	`requested_by_assessment_id` integer,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "surveys_public_id" CHECK("surveys"."public_id" GLOB 'srv_*'),
	CONSTRAINT "surveys_number_range" CHECK("surveys"."number" >= 1),
	CONSTRAINT "surveys_commit_sha" CHECK(length("surveys"."commit_sha") = 40 AND "surveys"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "surveys_tree_sha" CHECK("surveys"."tree_sha" IS NULL OR (length("surveys"."tree_sha") = 40 AND "surveys"."tree_sha" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "surveys_internal_ref" CHECK("surveys"."internal_ref" IS NULL OR "surveys"."internal_ref" GLOB 'refs/fabricate/snapshots/*' OR "surveys"."internal_ref" = 'refs/fabricate/previews/' || "surveys"."commit_sha"),
	CONSTRAINT "surveys_reference" CHECK(length("surveys"."reference") BETWEEN 1 AND 255),
	CONSTRAINT "surveys_configuration_digest" CHECK(length("surveys"."configuration_digest") = 64),
	CONSTRAINT "surveys_profile_schema_version" CHECK("surveys"."profile_schema_version" >= 1),
	CONSTRAINT "surveys_state" CHECK(state IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "surveys_trigger" CHECK(trigger IN ('added', 'edited', 'commit', 'recipe', 'manual', 'run', 'preview')),
	CONSTRAINT "surveys_attempts" CHECK("surveys"."attempts" >= 0),
	CONSTRAINT "surveys_failure" CHECK("surveys"."state" <> 'failed' OR "surveys"."failure_code" IS NOT NULL),
	CONSTRAINT "surveys_finished" CHECK(("surveys"."finished_at" IS NOT NULL) = ("surveys"."state" IN ('succeeded', 'failed'))),
	CONSTRAINT "surveys_pinned" CHECK("surveys"."state" <> 'succeeded' OR "surveys"."internal_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_public_id_unique` ON `surveys` (`public_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_key` ON `surveys` (`repository_source_id`,`commit_sha`,`surveyor_release`,`configuration_digest`,`profile_schema_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_number` ON `surveys` (`repository_source_id`,`number`);
--> statement-breakpoint
CREATE INDEX `surveys_state` ON `surveys` (`state`);
--> statement-breakpoint
CREATE TEMP TABLE profiling_assessments AS
SELECT a.id, a.public_id FROM assessments a JOIN initiatives i ON i.id = a.initiative_id WHERE i.profiling = 1;
--> statement-breakpoint
CREATE TEMP TABLE snapshot_facts AS
SELECT s.id AS snapshot_id, s.assessment_target_id AS target_id, s.repository_source_id, s.commit_sha, s.tree_sha, s.ref_kind, s.resolved_ref,
  s.internal_ref, s.acquired_at, s.created_at, t.assessment_id, t.state AS target_state, t.failure_code, t.failure_message,
  t.finished_at AS target_finished_at, t.git_ref IS rs.git_ref AS from_configured_reference, p.id AS profile_id,
  COALESCE(p.detector_release, a.detector_release) AS surveyor_release, a.configuration_digest,
  COALESCE(p.schema_version, a.profile_schema_version) AS profile_schema_version,
  CASE WHEN a.id IN (SELECT id FROM profiling_assessments)
    THEN CASE v.trigger WHEN 'imported' THEN 'added' WHEN 'initial' THEN 'added' WHEN 'detector' THEN 'recipe' ELSE v.trigger END
    ELSE 'run' END AS trigger,
  CASE WHEN a.id IN (SELECT id FROM profiling_assessments) THEN NULL ELSE a.id END AS requested_by
FROM source_snapshots s
JOIN assessment_targets t ON t.id = s.assessment_target_id
JOIN assessments a ON a.id = t.assessment_id
JOIN repository_sources rs ON rs.id = s.repository_source_id
LEFT JOIN repository_profiles p ON p.source_snapshot_id = s.id
LEFT JOIN profile_versions v ON v.assessment_id = a.id;
--> statement-breakpoint
CREATE TEMP TABLE keyed_snapshots AS
SELECT f.*,
  ROW_NUMBER() OVER (PARTITION BY repository_source_id, commit_sha, surveyor_release, configuration_digest, profile_schema_version ORDER BY created_at, snapshot_id) AS position_in_key,
  MIN(profile_id) OVER (PARTITION BY repository_source_id, commit_sha, surveyor_release, configuration_digest, profile_schema_version) AS key_profile_id
FROM snapshot_facts f;
--> statement-breakpoint
CREATE TEMP TABLE new_surveys AS
SELECT k.*, ROW_NUMBER() OVER (PARTITION BY k.repository_source_id ORDER BY k.created_at, k.snapshot_id) AS number,
  'srv_' || lower(hex(randomblob(8))) AS public_id
FROM keyed_snapshots k WHERE k.position_in_key = 1;
--> statement-breakpoint
INSERT INTO surveys (public_id, repository_source_id, number, commit_sha, tree_sha, internal_ref, reference, from_configured_reference, resolved_at,
  surveyor_release, configuration_digest, profile_schema_version, state, attempts, failure_code, failure_message, trigger, requested_by_assessment_id, created_at, finished_at)
SELECT n.public_id, n.repository_source_id, n.number, n.commit_sha, n.tree_sha, n.internal_ref, n.resolved_ref, n.from_configured_reference, n.acquired_at,
  n.surveyor_release, n.configuration_digest, n.profile_schema_version,
  CASE WHEN n.key_profile_id IS NOT NULL THEN 'succeeded' ELSE 'failed' END, 1,
  CASE WHEN n.key_profile_id IS NULL THEN COALESCE(n.failure_code, CASE n.target_state WHEN 'canceled' THEN 'canceled' ELSE 'analysis_failed' END) END,
  CASE WHEN n.key_profile_id IS NULL THEN COALESCE(n.failure_message, 'No Profile was recorded for this commit') END,
  n.trigger, n.requested_by, n.created_at,
  COALESCE((SELECT created_at FROM repository_profiles WHERE id = n.key_profile_id), n.target_finished_at, n.created_at)
FROM new_surveys n ORDER BY n.repository_source_id, n.number;
--> statement-breakpoint
CREATE TEMP TABLE snapshot_surveys AS
SELECT k.snapshot_id, k.target_id, v.id AS survey_id
FROM keyed_snapshots k JOIN surveys v ON v.repository_source_id = k.repository_source_id AND v.commit_sha = k.commit_sha
  AND v.surveyor_release = k.surveyor_release AND v.configuration_digest = k.configuration_digest AND v.profile_schema_version = k.profile_schema_version;
--> statement-breakpoint
CREATE TEMP TABLE preview_profiles AS
SELECT p.id AS preparation_id, p.repository_source_id, p.commit_sha, COALESCE(p.ref_name, p.commit_sha) AS reference, p.requested_at, p.updated_at,
  p.profile_document, p.profile_digest, json_extract(p.profile_document, '$.detector_release') AS surveyor_release,
  json_extract(p.profile_document, '$.detector_configuration_digest') AS configuration_digest,
  json_extract(p.profile_document, '$.schema_version') AS profile_schema_version
FROM preview_preparations p WHERE p.profile_document IS NOT NULL;
--> statement-breakpoint
INSERT INTO surveys (public_id, repository_source_id, number, commit_sha, tree_sha, internal_ref, reference, from_configured_reference, resolved_at,
  surveyor_release, configuration_digest, profile_schema_version, state, attempts, failure_code, failure_message, trigger, requested_by_assessment_id, created_at, finished_at)
SELECT 'srv_' || lower(hex(randomblob(8))), v.repository_source_id,
  (SELECT COALESCE(MAX(s.number), 0) FROM surveys s WHERE s.repository_source_id = v.repository_source_id) + ROW_NUMBER() OVER (PARTITION BY v.repository_source_id ORDER BY v.requested_at, v.preparation_id),
  v.commit_sha, NULL, 'refs/fabricate/previews/' || v.commit_sha, v.reference, 0, v.requested_at,
  v.surveyor_release, v.configuration_digest, v.profile_schema_version, 'succeeded', 1, NULL, NULL, 'preview', NULL, v.requested_at, v.updated_at
FROM preview_profiles v
WHERE NOT EXISTS (SELECT 1 FROM surveys s WHERE s.repository_source_id = v.repository_source_id AND s.commit_sha = v.commit_sha
  AND s.surveyor_release = v.surveyor_release AND s.configuration_digest = v.configuration_digest AND s.profile_schema_version = v.profile_schema_version);
--> statement-breakpoint
CREATE TABLE `__new_preview_preparations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`repository_source_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`ref_name` text,
	`ref_kind` text NOT NULL,
	`state` text DEFAULT 'profiling' NOT NULL,
	`survey_id` integer,
	`profile_digest` text,
	`packages` text,
	`refusal` text,
	`failure` text,
	`requested_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`survey_id`) REFERENCES `surveys`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "preview_preparations_public_id" CHECK("__new_preview_preparations"."public_id" GLOB 'ppr_*'),
	CONSTRAINT "preview_preparations_commit_sha" CHECK(length("__new_preview_preparations"."commit_sha") = 40 AND "__new_preview_preparations"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "preview_preparations_ref" CHECK("__new_preview_preparations"."ref_kind" IN ('branch', 'tag', 'commit') AND ("__new_preview_preparations"."ref_kind" = 'commit') = ("__new_preview_preparations"."ref_name" IS NULL) AND ("__new_preview_preparations"."ref_name" IS NULL OR length("__new_preview_preparations"."ref_name") BETWEEN 1 AND 255)),
	CONSTRAINT "preview_preparations_state" CHECK(state IN ('profiling', 'ready', 'refused', 'failed')),
	CONSTRAINT "preview_preparations_profile_digest" CHECK("__new_preview_preparations"."profile_digest" IS NULL OR (length("__new_preview_preparations"."profile_digest") = 64 AND "__new_preview_preparations"."profile_digest" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "preview_preparations_packages" CHECK("__new_preview_preparations"."packages" IS NULL OR (json_valid("__new_preview_preparations"."packages") AND json_type("__new_preview_preparations"."packages") = 'array')),
	CONSTRAINT "preview_preparations_refusal" CHECK("__new_preview_preparations"."refusal" IS NULL OR (json_valid("__new_preview_preparations"."refusal") AND json_type("__new_preview_preparations"."refusal") = 'object')),
	CONSTRAINT "preview_preparations_profiling" CHECK("__new_preview_preparations"."state" <> 'profiling' OR ("__new_preview_preparations"."packages" IS NULL AND "__new_preview_preparations"."refusal" IS NULL AND "__new_preview_preparations"."failure" IS NULL AND "__new_preview_preparations"."finished_at" IS NULL)),
	CONSTRAINT "preview_preparations_decided" CHECK("__new_preview_preparations"."state" NOT IN ('ready', 'refused') OR ("__new_preview_preparations"."profile_digest" IS NOT NULL AND "__new_preview_preparations"."survey_id" IS NOT NULL AND "__new_preview_preparations"."packages" IS NOT NULL AND "__new_preview_preparations"."failure" IS NULL AND "__new_preview_preparations"."finished_at" IS NOT NULL AND ("__new_preview_preparations"."state" = 'refused') = ("__new_preview_preparations"."refusal" IS NOT NULL))),
	CONSTRAINT "preview_preparations_failed" CHECK("__new_preview_preparations"."state" <> 'failed' OR ("__new_preview_preparations"."failure" IS NOT NULL AND length("__new_preview_preparations"."failure") > 0 AND "__new_preview_preparations"."refusal" IS NULL AND "__new_preview_preparations"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_preview_preparations`("id", "public_id", "repository_source_id", "commit_sha", "ref_name", "ref_kind", "state", "survey_id", "profile_digest", "packages", "refusal", "failure", "requested_at", "created_at", "updated_at", "finished_at") SELECT p."id", p."public_id", p."repository_source_id", p."commit_sha", p."ref_name", p."ref_kind", p."state", CASE
    WHEN p.repository_profile_id IS NOT NULL THEN (SELECT ss.survey_id FROM repository_profiles rp JOIN snapshot_surveys ss ON ss.snapshot_id = rp.source_snapshot_id WHERE rp.id = p.repository_profile_id)
    WHEN p.profile_document IS NOT NULL THEN (SELECT s.id FROM surveys s WHERE s.repository_source_id = p.repository_source_id AND s.commit_sha = p.commit_sha
      AND s.surveyor_release = json_extract(p.profile_document, '$.detector_release') AND s.configuration_digest = json_extract(p.profile_document, '$.detector_configuration_digest')
      AND s.profile_schema_version = json_extract(p.profile_document, '$.schema_version'))
  END, p."profile_digest", p."packages", p."refusal", p."failure", p."requested_at", p."created_at", p."updated_at", p."finished_at"
FROM `preview_preparations` p;
--> statement-breakpoint
DROP TABLE `preview_preparations`;
--> statement-breakpoint
ALTER TABLE `__new_preview_preparations` RENAME TO `preview_preparations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_preparations_public_id_unique` ON `preview_preparations` (`public_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_preparations_commit` ON `preview_preparations` (`repository_source_id`,`commit_sha`);
--> statement-breakpoint
CREATE TABLE `__new_repository_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`survey_id` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`detector_release` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`survey_id`) REFERENCES `surveys`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "repository_profiles_public_id" CHECK("__new_repository_profiles"."public_id" GLOB 'prf_*'),
	CONSTRAINT "repository_profiles_digest" CHECK(length("__new_repository_profiles"."digest") = 64),
	CONSTRAINT "repository_profiles_document" CHECK(json_valid("__new_repository_profiles"."document") AND json_type("__new_repository_profiles"."document") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_repository_profiles`("id", "public_id", "survey_id", "schema_version", "detector_release", "document", "digest", "created_at")
SELECT p.id, p.public_id, ss.survey_id, p.schema_version, p.detector_release, p.document, p.digest, p.created_at
FROM repository_profiles p JOIN snapshot_surveys ss ON ss.snapshot_id = p.source_snapshot_id
WHERE p.id IN (SELECT key_profile_id FROM new_surveys WHERE key_profile_id IS NOT NULL);
--> statement-breakpoint
INSERT INTO `__new_repository_profiles`("public_id", "survey_id", "schema_version", "detector_release", "document", "digest", "created_at")
SELECT 'prf_' || lower(hex(randomblob(8))), s.id, v.profile_schema_version, v.surveyor_release, v.profile_document, v.profile_digest, v.updated_at
FROM preview_profiles v JOIN surveys s ON s.repository_source_id = v.repository_source_id AND s.commit_sha = v.commit_sha
  AND s.surveyor_release = v.surveyor_release AND s.configuration_digest = v.configuration_digest AND s.profile_schema_version = v.profile_schema_version
WHERE s.trigger = 'preview' AND NOT EXISTS (SELECT 1 FROM `__new_repository_profiles` n WHERE n.survey_id = s.id);
--> statement-breakpoint
DROP TABLE `repository_profiles`;
--> statement-breakpoint
ALTER TABLE `__new_repository_profiles` RENAME TO `repository_profiles`;
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_profiles_public_id_unique` ON `repository_profiles` (`public_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_profiles_survey_id_unique` ON `repository_profiles` (`survey_id`);
--> statement-breakpoint
CREATE TABLE `__new_dependency_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`kind` text NOT NULL,
	`manifest` text NOT NULL,
	`package_name` text NOT NULL,
	`field` text,
	`specifier` text,
	`resolved_version` text,
	`state` text NOT NULL,
	`evidence` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dependency_facts_package_name" CHECK(length("__new_dependency_facts"."package_name") > 0),
	CONSTRAINT "dependency_facts_kind" CHECK(kind IN ('dependency', 'produced')),
	CONSTRAINT "dependency_facts_evidence" CHECK(json_valid("__new_dependency_facts"."evidence") AND json_type("__new_dependency_facts"."evidence") = 'array'),
	CONSTRAINT "dependency_facts_document_digest" CHECK(length("__new_dependency_facts"."document_digest") = 64),
	CONSTRAINT "dependency_facts_projection_version" CHECK("__new_dependency_facts"."projection_version" > 0)
);
--> statement-breakpoint
DROP TABLE `dependency_facts`;
--> statement-breakpoint
ALTER TABLE `__new_dependency_facts` RENAME TO `dependency_facts`;
--> statement-breakpoint
CREATE INDEX `dependency_facts_profile_package` ON `dependency_facts` (`profile_id`,`package_name`);
--> statement-breakpoint
CREATE INDEX `dependency_facts_kind_package` ON `dependency_facts` (`kind`,`package_name`);
--> statement-breakpoint
CREATE INDEX `dependency_facts_package_version` ON `dependency_facts` (`package_name`,`resolved_version`);
--> statement-breakpoint
CREATE TABLE `__new_evidence_index` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`evidence_id` text NOT NULL,
	`path` text NOT NULL,
	`location_kind` text NOT NULL,
	`line_start` integer,
	`line_end` integer,
	`pointer` text,
	`pointer_format` text,
	`detector` text NOT NULL,
	`rule` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_index_location_kind" CHECK(location_kind IN ('lines', 'pointer', 'entry')),
	CONSTRAINT "evidence_index_lines" CHECK(("__new_evidence_index"."location_kind" = 'lines') = ("__new_evidence_index"."line_start" IS NOT NULL AND "__new_evidence_index"."line_end" IS NOT NULL)),
	CONSTRAINT "evidence_index_pointer" CHECK(("__new_evidence_index"."location_kind" = 'pointer') = ("__new_evidence_index"."pointer" IS NOT NULL)),
	CONSTRAINT "evidence_index_document_digest" CHECK(length("__new_evidence_index"."document_digest") = 64),
	CONSTRAINT "evidence_index_projection_version" CHECK("__new_evidence_index"."projection_version" > 0)
);
--> statement-breakpoint
DROP TABLE `evidence_index`;
--> statement-breakpoint
ALTER TABLE `__new_evidence_index` RENAME TO `evidence_index`;
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_index_profile_evidence` ON `evidence_index` (`profile_id`,`evidence_id`);
--> statement-breakpoint
CREATE TEMP TABLE profiling_targets AS SELECT id, public_id FROM assessment_targets WHERE assessment_id IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
DELETE FROM jobs
WHERE json_extract(payload, '$.assessment') IN (SELECT public_id FROM profiling_assessments)
  OR json_extract(payload, '$.target') IN (SELECT public_id FROM profiling_targets);
--> statement-breakpoint
DELETE FROM graph_edge_candidates WHERE assessment_id IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
DELETE FROM graph_edges WHERE assessment_id IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
DELETE FROM graph_nodes WHERE assessment_id IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
DELETE FROM relationship_maps WHERE assessment_id IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
CREATE TABLE `__new_initiatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`selection_mode` text DEFAULT 'all' NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "initiatives_public_id" CHECK("__new_initiatives"."public_id" GLOB 'ini_*'),
	CONSTRAINT "initiatives_name" CHECK(length(trim("__new_initiatives"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "initiatives_objective" CHECK(length("__new_initiatives"."objective") <= 2000),
	CONSTRAINT "initiatives_selection_mode" CHECK(selection_mode IN ('all', 'explicit'))
);
--> statement-breakpoint
INSERT INTO `__new_initiatives`("id", "public_id", "name", "objective", "selection_mode", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "name", "objective", "selection_mode", "lock_version", "created_at", "updated_at" FROM `initiatives` WHERE profiling = 0;
--> statement-breakpoint
DROP TABLE `initiatives`;
--> statement-breakpoint
ALTER TABLE `__new_initiatives` RENAME TO `initiatives`;
--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_public_id_unique` ON `initiatives` (`public_id`);
--> statement-breakpoint
ALTER TABLE `repository_sources` ADD `current_survey_id` integer REFERENCES surveys(id);
--> statement-breakpoint
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
	`ref_kind` text,
	`resolved_ref` text,
	`resolved_at` integer,
	`survey_id` integer,
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
	FOREIGN KEY (`survey_id`) REFERENCES `surveys`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assessment_targets_public_id" CHECK("__new_assessment_targets"."public_id" GLOB 'tgt_*'),
	CONSTRAINT "assessment_targets_position_range" CHECK("__new_assessment_targets"."position" >= 0),
	CONSTRAINT "assessment_targets_state" CHECK(state IN ('pending', 'acquiring', 'analyzing', 'complete', 'failed', 'canceled')),
	CONSTRAINT "assessment_targets_failure_code" CHECK(("__new_assessment_targets"."failure_code" IS NOT NULL) = ("__new_assessment_targets"."state" = 'failed')),
	CONSTRAINT "assessment_targets_ref_kind" CHECK(ref_kind IS NULL OR ref_kind IN ('default_branch', 'branch', 'tag', 'commit')),
	CONSTRAINT "assessment_targets_resolution" CHECK(("__new_assessment_targets"."ref_kind" IS NULL) = ("__new_assessment_targets"."resolved_ref" IS NULL) AND ("__new_assessment_targets"."ref_kind" IS NULL) = ("__new_assessment_targets"."resolved_at" IS NULL) AND ("__new_assessment_targets"."survey_id" IS NULL OR "__new_assessment_targets"."ref_kind" IS NOT NULL)),
	CONSTRAINT "assessment_targets_complete_survey" CHECK("__new_assessment_targets"."state" <> 'complete' OR "__new_assessment_targets"."survey_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_assessment_targets`("id", "public_id", "assessment_id", "repository_source_id", "position", "source_public_id", "source_name", "clone_url", "canonical_url", "git_ref", "state", "failure_code", "failure_message", "started_at", "finished_at", "lock_version", "created_at", "updated_at", "ref_kind", "resolved_ref", "resolved_at", "survey_id")
SELECT t."id", t."public_id", t."assessment_id", t."repository_source_id", t."position", t."source_public_id", t."source_name", t."clone_url", t."canonical_url", t."git_ref", t."state", t."failure_code", t."failure_message", t."started_at", t."finished_at", t."lock_version", t."created_at", t."updated_at", s.ref_kind, s.resolved_ref, s.acquired_at, ss.survey_id
FROM `assessment_targets` t LEFT JOIN source_snapshots s ON s.assessment_target_id = t.id LEFT JOIN snapshot_surveys ss ON ss.snapshot_id = s.id
WHERE t.assessment_id NOT IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
DROP TABLE `assessment_targets`;
--> statement-breakpoint
ALTER TABLE `__new_assessment_targets` RENAME TO `assessment_targets`;
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_public_id_unique` ON `assessment_targets` (`public_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_position` ON `assessment_targets` (`assessment_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_source` ON `assessment_targets` (`assessment_id`,`repository_source_id`);
--> statement-breakpoint
CREATE INDEX `assessment_targets_repository_source` ON `assessment_targets` (`repository_source_id`);
--> statement-breakpoint
CREATE INDEX `assessment_targets_survey` ON `assessment_targets` (`survey_id`);
--> statement-breakpoint
DELETE FROM assessments WHERE id IN (SELECT id FROM profiling_assessments);
--> statement-breakpoint
DROP TABLE `source_snapshots`;
--> statement-breakpoint
DROP TABLE `profile_versions`;
--> statement-breakpoint
ALTER TABLE `repository_sources` ADD `configured_commit` text;
--> statement-breakpoint
ALTER TABLE `repository_sources` ADD `configured_resolved_at` integer;
--> statement-breakpoint
UPDATE repository_sources SET current_survey_id = (
  SELECT s.id FROM surveys s WHERE s.repository_source_id = repository_sources.id AND s.state = 'succeeded' AND s.from_configured_reference = 1
  ORDER BY s.resolved_at DESC, s.id DESC LIMIT 1)
WHERE deleted_at IS NULL;
--> statement-breakpoint
UPDATE repository_sources SET configured_commit = s.commit_sha, configured_resolved_at = s.resolved_at
FROM surveys s WHERE s.id = repository_sources.current_survey_id;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_created_with_assessment
BEFORE INSERT ON assessment_targets
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) IS NOT 'queued'
  OR NEW.created_at IS NOT (SELECT created_at FROM assessments WHERE id = NEW.assessment_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope is frozen when the assessment is created');
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
-- A target resolves its reference and links its survey once.
CREATE TRIGGER assessment_targets_resolution_fixed
BEFORE UPDATE ON assessment_targets
WHEN (OLD.ref_kind IS NOT NULL AND (NEW.ref_kind IS NOT OLD.ref_kind OR NEW.resolved_ref IS NOT OLD.resolved_ref OR NEW.resolved_at IS NOT OLD.resolved_at))
  OR (OLD.survey_id IS NOT NULL AND NEW.survey_id IS NOT OLD.survey_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: a target resolves its reference and links its survey once');
END;
--> statement-breakpoint
-- A target links a survey of its own Repository.
CREATE TRIGGER assessment_targets_survey_matches
BEFORE UPDATE OF survey_id ON assessment_targets
WHEN NEW.survey_id IS NOT NULL AND (SELECT repository_source_id FROM surveys WHERE id = NEW.survey_id) IS NOT NEW.repository_source_id
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: a target links a survey of its own Repository');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_never_deleted
BEFORE DELETE ON assessment_targets
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER assessments_never_deleted
BEFORE DELETE ON assessments
BEGIN
  SELECT RAISE(ABORT, 'assessments: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER relationship_maps_never_deleted
BEFORE DELETE ON relationship_maps
BEGIN
  SELECT RAISE(ABORT, 'relationship_maps: results are retained and cannot be deleted');
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
CREATE TRIGGER preview_builds_prepared
BEFORE INSERT ON preview_builds
WHEN NOT EXISTS (
  SELECT 1 FROM preview_preparations p
  WHERE p.id = NEW.preparation_id AND p.repository_source_id = NEW.repository_source_id AND p.commit_sha = NEW.commit_sha AND p.state = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'preview_builds: a preview is built only from a ready preparation of its Repository and commit');
END;
--> statement-breakpoint
CREATE TRIGGER preview_preparations_identity_fixed
BEFORE UPDATE ON preview_preparations
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.repository_source_id IS NOT OLD.repository_source_id OR NEW.commit_sha IS NOT OLD.commit_sha
  OR NEW.ref_name IS NOT OLD.ref_name OR NEW.ref_kind IS NOT OLD.ref_kind OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'preview_preparations: a preparation keeps its Repository, commit, and ref');
END;
--> statement-breakpoint
-- A preparation links a survey of its own Repository and commit.
CREATE TRIGGER preview_preparations_survey_matches
BEFORE UPDATE OF survey_id ON preview_preparations
WHEN NEW.survey_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM surveys s WHERE s.id = NEW.survey_id AND s.repository_source_id = NEW.repository_source_id AND s.commit_sha = NEW.commit_sha
)
BEGIN
  SELECT RAISE(ABORT, 'preview_preparations: a preparation links a survey of its Repository and commit');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_immutable
BEFORE UPDATE ON repository_profiles
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: Profiles are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_never_deleted
BEFORE DELETE ON repository_profiles
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A Profile is written while its survey runs, which then succeeds in the same transaction.
CREATE TRIGGER repository_profiles_written_by_survey
BEFORE INSERT ON repository_profiles
WHEN (SELECT state FROM surveys WHERE id = NEW.survey_id) IS NOT 'running'
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: a Profile is written by its running survey');
END;
--> statement-breakpoint
CREATE TRIGGER dependency_facts_immutable
BEFORE UPDATE ON dependency_facts
BEGIN
  SELECT RAISE(ABORT, 'dependency_facts: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER evidence_index_immutable
BEFORE UPDATE ON evidence_index
BEGIN
  SELECT RAISE(ABORT, 'evidence_index: projection rows are written once');
END;
--> statement-breakpoint
-- A survey's Repository, number, commit, reference, recipe, and reason never change.
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
-- Its tree and internal ref are set once, when the commit is pinned.
CREATE TRIGGER surveys_pin_fixed
BEFORE UPDATE ON surveys
WHEN (OLD.tree_sha IS NOT NULL AND NEW.tree_sha IS NOT OLD.tree_sha)
  OR (OLD.internal_ref IS NOT NULL AND NEW.internal_ref IS NOT OLD.internal_ref)
BEGIN
  SELECT RAISE(ABORT, 'surveys: a pinned commit stays pinned');
END;
--> statement-breakpoint
-- Each Repository's surveys are numbered 1, 2, 3, in the order they're created.
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
-- A Repository's current survey is one of its own successful surveys, of the commit its configured reference last named.
CREATE TRIGGER repository_sources_current_survey
BEFORE UPDATE OF current_survey_id ON repository_sources
WHEN NEW.current_survey_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM surveys s WHERE s.id = NEW.current_survey_id AND s.repository_source_id = NEW.id AND s.state = 'succeeded' AND s.commit_sha IS NEW.configured_commit
)
BEGIN
  SELECT RAISE(ABORT, 'repository_sources: the current survey is a successful survey of the commit the configured reference names');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_initial_state
BEFORE INSERT ON assessment_targets
WHEN NEW.state IS NOT 'pending'
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: new targets start pending');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_terminal_frozen
BEFORE UPDATE ON assessment_targets
WHEN OLD.state IN ('complete', 'failed', 'canceled')
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: a terminal target cannot change');
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
DROP TABLE profiling_assessments;
--> statement-breakpoint
DROP TABLE profiling_targets;
--> statement-breakpoint
DROP TABLE snapshot_facts;
--> statement-breakpoint
DROP TABLE keyed_snapshots;
--> statement-breakpoint
DROP TABLE new_surveys;
--> statement-breakpoint
DROP TABLE snapshot_surveys;
--> statement-breakpoint
DROP TABLE preview_profiles;
--> statement-breakpoint
CREATE TEMP TABLE surveys_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO surveys_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE surveys_foreign_keys;
