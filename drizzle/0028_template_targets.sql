-- Triggers on other tables that read the tables rebuilt below; a rename
-- refuses to run while they point at a dropped table. They come back, unchanged,
-- after the rebuilds.
DROP TRIGGER initiative_targets_require_explicit_mode;--> statement-breakpoint
DROP TRIGGER initiative_targets_claim_only;--> statement-breakpoint
DROP TRIGGER initiative_targets_claim_kept;--> statement-breakpoint
DROP TRIGGER repository_profiles_match_snapshot;--> statement-breakpoint
DROP TRIGGER findings_match_pinned_release;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_source_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_target_id` integer NOT NULL,
	`repository_source_id` integer,
	`commit_sha` text,
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
	CONSTRAINT "source_snapshots_object_ids" CHECK(("__new_source_snapshots"."commit_sha" IS NULL OR (length("__new_source_snapshots"."commit_sha") = 40 AND "__new_source_snapshots"."commit_sha" NOT GLOB '*[^0-9a-f]*')) AND length("__new_source_snapshots"."tree_sha") = 40 AND "__new_source_snapshots"."tree_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "source_snapshots_stored_files" CHECK(("__new_source_snapshots"."ref_kind" = 'stored_files') = ("__new_source_snapshots"."commit_sha" IS NULL) AND ("__new_source_snapshots"."commit_sha" IS NULL) = ("__new_source_snapshots"."repository_source_id" IS NULL)),
	CONSTRAINT "source_snapshots_ref_kind" CHECK(ref_kind IN ('default_branch', 'branch', 'tag', 'commit', 'stored_files')),
	CONSTRAINT "source_snapshots_internal_ref" CHECK("__new_source_snapshots"."internal_ref" = 'refs/fabricate/snapshots/' || "__new_source_snapshots"."public_id")
);
--> statement-breakpoint
INSERT INTO `__new_source_snapshots`("id", "public_id", "assessment_target_id", "repository_source_id", "commit_sha", "tree_sha", "ref_kind", "resolved_ref", "internal_ref", "acquisition_metadata", "acquired_at", "created_at") SELECT "id", "public_id", "assessment_target_id", "repository_source_id", "commit_sha", "tree_sha", "ref_kind", "resolved_ref", "internal_ref", "acquisition_metadata", "acquired_at", "created_at" FROM `source_snapshots`;--> statement-breakpoint
DROP TABLE `source_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_source_snapshots` RENAME TO `source_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_public_id_unique` ON `source_snapshots` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_assessment_target_id_unique` ON `source_snapshots` (`assessment_target_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_internal_ref_unique` ON `source_snapshots` (`internal_ref`);--> statement-breakpoint
CREATE INDEX `source_snapshots_commit` ON `source_snapshots` (`commit_sha`);--> statement-breakpoint
CREATE INDEX `source_snapshots_repository_source` ON `source_snapshots` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `__new_assessment_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`assessment_id` integer NOT NULL,
	`kind` text DEFAULT 'source' NOT NULL,
	`repository_source_id` integer,
	`position` integer NOT NULL,
	`source_public_id` text NOT NULL,
	`source_name` text NOT NULL,
	`clone_url` text,
	`canonical_url` text,
	`git_ref` text,
	`template_public_id` text,
	`template_version_public_id` text,
	`template_version_number` integer,
	`prototype_version_public_id` text,
	`content_digest` text,
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
	CONSTRAINT "assessment_targets_failure_code" CHECK(("__new_assessment_targets"."failure_code" IS NOT NULL) = ("__new_assessment_targets"."state" = 'failed')),
	CONSTRAINT "assessment_targets_kind" CHECK(kind IN ('source', 'template')),
	CONSTRAINT "assessment_targets_kind_columns" CHECK(("__new_assessment_targets"."kind" = 'source' AND "__new_assessment_targets"."repository_source_id" IS NOT NULL AND "__new_assessment_targets"."clone_url" IS NOT NULL AND "__new_assessment_targets"."canonical_url" IS NOT NULL
          AND "__new_assessment_targets"."template_public_id" IS NULL AND "__new_assessment_targets"."template_version_public_id" IS NULL AND "__new_assessment_targets"."template_version_number" IS NULL AND "__new_assessment_targets"."prototype_version_public_id" IS NULL AND "__new_assessment_targets"."content_digest" IS NULL)
        OR ("__new_assessment_targets"."kind" = 'template' AND "__new_assessment_targets"."repository_source_id" IS NULL AND "__new_assessment_targets"."clone_url" IS NULL AND "__new_assessment_targets"."canonical_url" IS NULL AND "__new_assessment_targets"."git_ref" IS NULL
          AND "__new_assessment_targets"."prototype_version_public_id" IS NOT NULL AND "__new_assessment_targets"."prototype_version_public_id" GLOB 'ver_*'
          AND "__new_assessment_targets"."content_digest" IS NOT NULL AND length("__new_assessment_targets"."content_digest") = 40 AND "__new_assessment_targets"."content_digest" NOT GLOB '*[^0-9a-f]*'
          AND (("__new_assessment_targets"."template_public_id" IS NULL AND "__new_assessment_targets"."template_version_public_id" IS NULL AND "__new_assessment_targets"."template_version_number" IS NULL)
            OR ("__new_assessment_targets"."template_public_id" IS NOT NULL AND "__new_assessment_targets"."template_version_public_id" IS NOT NULL AND "__new_assessment_targets"."template_version_number" IS NOT NULL
              AND "__new_assessment_targets"."template_public_id" GLOB 'ptp_*' AND "__new_assessment_targets"."template_version_public_id" GLOB 'ptv_*' AND "__new_assessment_targets"."template_version_number" >= 1))))
);
--> statement-breakpoint
INSERT INTO `__new_assessment_targets`("id", "public_id", "assessment_id", "kind", "repository_source_id", "position", "source_public_id", "source_name", "clone_url", "canonical_url", "git_ref", "template_public_id", "template_version_public_id", "template_version_number", "prototype_version_public_id", "content_digest", "state", "failure_code", "failure_message", "started_at", "finished_at", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "assessment_id", 'source', "repository_source_id", "position", "source_public_id", "source_name", "clone_url", "canonical_url", "git_ref", NULL, NULL, NULL, NULL, NULL, "state", "failure_code", "failure_message", "started_at", "finished_at", "lock_version", "created_at", "updated_at" FROM `assessment_targets`;--> statement-breakpoint
DROP TABLE `assessment_targets`;--> statement-breakpoint
ALTER TABLE `__new_assessment_targets` RENAME TO `assessment_targets`;--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_public_id_unique` ON `assessment_targets` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_position` ON `assessment_targets` (`assessment_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_targets_source` ON `assessment_targets` (`assessment_id`,`repository_source_id`);--> statement-breakpoint
CREATE INDEX `assessment_targets_repository_source` ON `assessment_targets` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `__new_initiatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`selection_mode` text DEFAULT 'all_enabled' NOT NULL,
	`claim_repository_source_id` integer,
	`system_owned` integer DEFAULT false NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`claim_repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "initiatives_public_id" CHECK("__new_initiatives"."public_id" GLOB 'ini_*'),
	CONSTRAINT "initiatives_name" CHECK(length(trim("__new_initiatives"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "initiatives_objective" CHECK(length("__new_initiatives"."objective") <= 2000),
	CONSTRAINT "initiatives_selection_mode" CHECK(selection_mode IN ('all_enabled', 'explicit')),
	CONSTRAINT "initiatives_system_owned" CHECK("__new_initiatives"."system_owned" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_initiatives`("id", "public_id", "name", "objective", "selection_mode", "claim_repository_source_id", "system_owned", "lock_version", "created_at", "updated_at") SELECT "id", "public_id", "name", "objective", "selection_mode", "claim_repository_source_id", 0, "lock_version", "created_at", "updated_at" FROM `initiatives`;--> statement-breakpoint
DROP TABLE `initiatives`;--> statement-breakpoint
ALTER TABLE `__new_initiatives` RENAME TO `initiatives`;--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_public_id_unique` ON `initiatives` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_claim_repository_source` ON `initiatives` (`claim_repository_source_id`);--> statement-breakpoint
-- The triggers of the tables the rebuilds above dropped, recreated, with
-- template targets held to their own rules (converge-templates-and-prototypes,
-- design decision 2). Messages start with the table name so callers can
-- report which rule fired.
CREATE TRIGGER assessment_targets_created_with_assessment
BEFORE INSERT ON assessment_targets
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) IS NOT 'queued'
  OR NEW.created_at IS NOT (SELECT created_at FROM assessments WHERE id = NEW.assessment_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope is frozen when the assessment is created');
END;
--> statement-breakpoint
-- Template versions are assessed only under the system-owned initiative, and
-- catalog sources only under the others.
CREATE TRIGGER assessment_targets_kind_matches_initiative
BEFORE INSERT ON assessment_targets
WHEN (NEW.kind = 'template') IS NOT (
  SELECT initiatives.system_owned = 1 FROM assessments JOIN initiatives ON initiatives.id = assessments.initiative_id WHERE assessments.id = NEW.assessment_id
)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: template versions are assessed under the Salt Patterns initiative only');
END;
--> statement-breakpoint
-- Copied source configuration, or a template version's identity and digest,
-- never changes, whatever happens in the catalog or the gallery.
CREATE TRIGGER assessment_targets_scope_immutable
BEFORE UPDATE ON assessment_targets
WHEN NEW.public_id IS NOT OLD.public_id
  OR NEW.assessment_id IS NOT OLD.assessment_id
  OR NEW.kind IS NOT OLD.kind
  OR NEW.repository_source_id IS NOT OLD.repository_source_id
  OR NEW.position IS NOT OLD.position
  OR NEW.source_public_id IS NOT OLD.source_public_id
  OR NEW.source_name IS NOT OLD.source_name
  OR NEW.clone_url IS NOT OLD.clone_url
  OR NEW.canonical_url IS NOT OLD.canonical_url
  OR NEW.git_ref IS NOT OLD.git_ref
  OR NEW.template_public_id IS NOT OLD.template_public_id
  OR NEW.template_version_public_id IS NOT OLD.template_version_public_id
  OR NEW.template_version_number IS NOT OLD.template_version_number
  OR NEW.prototype_version_public_id IS NOT OLD.prototype_version_public_id
  OR NEW.content_digest IS NOT OLD.content_digest
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope snapshot cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_never_deleted
BEFORE DELETE ON assessment_targets
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: results are retained and cannot be deleted');
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
-- A snapshot is recorded once, for its own target's source while that target
-- is acquiring, and never changes. A template target's snapshot is its stored
-- files, whose tree is the target's content digest.
CREATE TRIGGER source_snapshots_match_target
BEFORE INSERT ON source_snapshots
WHEN NEW.repository_source_id IS NOT (SELECT repository_source_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'acquiring'
  OR (NEW.ref_kind = 'stored_files') IS NOT (SELECT kind = 'template' FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (NEW.ref_kind = 'stored_files' AND NEW.tree_sha IS NOT (SELECT content_digest FROM assessment_targets WHERE id = NEW.assessment_target_id))
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: a snapshot is recorded for its acquiring target');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_immutable
BEFORE UPDATE ON source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_never_deleted
BEFORE DELETE ON source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: results are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_all_enabled_has_no_targets
BEFORE UPDATE OF selection_mode ON initiatives
WHEN NEW.selection_mode = 'all_enabled' AND EXISTS (SELECT 1 FROM initiative_targets WHERE initiative_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'initiatives: remove explicit selections before targeting all enabled sources');
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
-- The Salt Patterns initiative: DE FabLab owns it, and its targets are the
-- template versions it assesses. Operators choose its Releases, nothing else.
INSERT INTO initiatives (public_id, name, objective, selection_mode, system_owned, created_at, updated_at)
VALUES (
  'ini_saltpatterns0000',
  'Salt Patterns',
  'Holds every template version to the Standards selected here before it joins the gallery, and again when a template is re-checked. DE FabLab owns this initiative and adds its targets; choose which Releases templates must meet.',
  'explicit',
  1,
  CAST(unixepoch('subsec') * 1000 AS integer),
  CAST(unixepoch('subsec') * 1000 AS integer)
);
--> statement-breakpoint
-- The migration above seeds the only system-owned initiative.
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
-- Its targets are template versions, never catalog sources.
CREATE TRIGGER initiative_targets_not_system_owned
BEFORE INSERT ON initiative_targets
WHEN (SELECT system_owned FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: the Salt Patterns initiative assesses template versions, not catalog sources');
END;
--> statement-breakpoint
-- The triggers dropped before the rebuilds, unchanged.
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
CREATE TRIGGER repository_profiles_match_snapshot
BEFORE INSERT ON repository_profiles
WHEN NEW.assessment_target_id IS NOT (SELECT assessment_target_id FROM source_snapshots WHERE id = NEW.source_snapshot_id)
  OR NEW.assessment_id IS NOT (SELECT assessment_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'analyzing'
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: a Profile is written for its analyzing target and pinned snapshot');
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
-- Every row the rebuilds copied still points at what it pointed at before;
-- a violation fails the migration, and the whole run rolls back.
CREATE TEMP TABLE template_targets_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO template_targets_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE template_targets_foreign_keys;
