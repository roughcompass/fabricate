-- Repository previews (docs/previews.md). A preparation pins one commit of a
-- Repository and decides, from a Profile of that commit, which packages can
-- be previewed; it exists before any build does. A preview build is one
-- Repository, commit, and package, unique among undeleted rows, with its
-- latest attempt tracked apart from the artifact it last published. Both
-- tables are unused while previews.enabled is off.
CREATE TABLE `preview_preparations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`repository_source_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`ref_name` text,
	`ref_kind` text NOT NULL,
	`state` text DEFAULT 'profiling' NOT NULL,
	`repository_profile_id` integer,
	`profile_document` text,
	`profile_digest` text,
	`packages` text,
	`refusal` text,
	`failure` text,
	`requested_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "preview_preparations_public_id" CHECK("preview_preparations"."public_id" GLOB 'ppr_*'),
	CONSTRAINT "preview_preparations_commit_sha" CHECK(length("preview_preparations"."commit_sha") = 40 AND "preview_preparations"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "preview_preparations_ref" CHECK("preview_preparations"."ref_kind" IN ('branch', 'tag', 'commit') AND ("preview_preparations"."ref_kind" = 'commit') = ("preview_preparations"."ref_name" IS NULL) AND ("preview_preparations"."ref_name" IS NULL OR length("preview_preparations"."ref_name") BETWEEN 1 AND 255)),
	CONSTRAINT "preview_preparations_state" CHECK(state IN ('profiling', 'ready', 'refused', 'failed')),
	CONSTRAINT "preview_preparations_profile_digest" CHECK("preview_preparations"."profile_digest" IS NULL OR (length("preview_preparations"."profile_digest") = 64 AND "preview_preparations"."profile_digest" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "preview_preparations_profile_document" CHECK("preview_preparations"."profile_document" IS NULL OR (json_valid("preview_preparations"."profile_document") AND json_type("preview_preparations"."profile_document") = 'object')),
	CONSTRAINT "preview_preparations_packages" CHECK("preview_preparations"."packages" IS NULL OR (json_valid("preview_preparations"."packages") AND json_type("preview_preparations"."packages") = 'array')),
	CONSTRAINT "preview_preparations_refusal" CHECK("preview_preparations"."refusal" IS NULL OR (json_valid("preview_preparations"."refusal") AND json_type("preview_preparations"."refusal") = 'object')),
	CONSTRAINT "preview_preparations_profiling" CHECK("preview_preparations"."state" <> 'profiling' OR ("preview_preparations"."packages" IS NULL AND "preview_preparations"."refusal" IS NULL AND "preview_preparations"."failure" IS NULL AND "preview_preparations"."finished_at" IS NULL)),
	CONSTRAINT "preview_preparations_decided" CHECK("preview_preparations"."state" NOT IN ('ready', 'refused') OR ("preview_preparations"."profile_digest" IS NOT NULL AND ("preview_preparations"."repository_profile_id" IS NULL) <> ("preview_preparations"."profile_document" IS NULL) AND "preview_preparations"."packages" IS NOT NULL AND "preview_preparations"."failure" IS NULL AND "preview_preparations"."finished_at" IS NOT NULL AND ("preview_preparations"."state" = 'refused') = ("preview_preparations"."refusal" IS NOT NULL))),
	CONSTRAINT "preview_preparations_failed" CHECK("preview_preparations"."state" <> 'failed' OR ("preview_preparations"."failure" IS NOT NULL AND length("preview_preparations"."failure") > 0 AND "preview_preparations"."refusal" IS NULL AND "preview_preparations"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_preparations_public_id_unique` ON `preview_preparations` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `preview_preparations_commit` ON `preview_preparations` (`repository_source_id`,`commit_sha`);--> statement-breakpoint
CREATE TABLE `preview_builds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`repository_source_id` integer NOT NULL,
	`preparation_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`package_dir` text NOT NULL,
	`ref_name` text,
	`ref_kind` text NOT NULL,
	`profile_digest` text NOT NULL,
	`deciding_facts` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`attempt_state` text DEFAULT 'queued' NOT NULL,
	`attempt_claim` text,
	`attempt_reason` text,
	`attempt_log` text,
	`attempt_started_at` integer,
	`artifact` text,
	`artifact_attempt` integer,
	`artifact_layout` text,
	`artifact_entry` text,
	`output_bytes` integer,
	`build_ms` integer,
	`node_version` text,
	`package_manager` text,
	`last_opened_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`preparation_id`) REFERENCES `preview_preparations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "preview_builds_public_id" CHECK("preview_builds"."public_id" GLOB 'pvw_*'),
	CONSTRAINT "preview_builds_commit_sha" CHECK(length("preview_builds"."commit_sha") = 40 AND "preview_builds"."commit_sha" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "preview_builds_package_dir" CHECK("preview_builds"."package_dir" = '.' OR (length("preview_builds"."package_dir") BETWEEN 1 AND 1024 AND "preview_builds"."package_dir" NOT GLOB '/*' AND "preview_builds"."package_dir" NOT GLOB '*/' AND "preview_builds"."package_dir" NOT GLOB '*//*' AND ('/' || "preview_builds"."package_dir" || '/') NOT GLOB '*/./*' AND ('/' || "preview_builds"."package_dir" || '/') NOT GLOB '*/../*')),
	CONSTRAINT "preview_builds_ref" CHECK("preview_builds"."ref_kind" IN ('branch', 'tag', 'commit') AND ("preview_builds"."ref_kind" = 'commit') = ("preview_builds"."ref_name" IS NULL) AND ("preview_builds"."ref_name" IS NULL OR length("preview_builds"."ref_name") BETWEEN 1 AND 255)),
	CONSTRAINT "preview_builds_profile_digest" CHECK(length("preview_builds"."profile_digest") = 64 AND "preview_builds"."profile_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "preview_builds_deciding_facts" CHECK(json_valid("preview_builds"."deciding_facts") AND json_type("preview_builds"."deciding_facts") = 'object'),
	CONSTRAINT "preview_builds_attempt" CHECK("preview_builds"."attempt" >= 1),
	CONSTRAINT "preview_builds_attempt_state" CHECK(attempt_state IN ('queued', 'building', 'ready', 'failed')),
	CONSTRAINT "preview_builds_attempt_reason" CHECK(("preview_builds"."attempt_state" = 'failed') = ("preview_builds"."attempt_reason" IS NOT NULL)),
	CONSTRAINT "preview_builds_artifact_layout" CHECK(artifact_layout IS NULL OR artifact_layout IN ('standalone', 'module_federation', 'single_spa')),
	CONSTRAINT "preview_builds_artifact" CHECK(("preview_builds"."artifact" IS NULL) = ("preview_builds"."artifact_attempt" IS NULL) AND ("preview_builds"."artifact" IS NULL) = ("preview_builds"."artifact_layout" IS NULL) AND ("preview_builds"."artifact" IS NULL) = ("preview_builds"."artifact_entry" IS NULL) AND ("preview_builds"."artifact" IS NULL) = ("preview_builds"."output_bytes" IS NULL) AND ("preview_builds"."artifact" IS NULL) = ("preview_builds"."build_ms" IS NULL) AND ("preview_builds"."artifact" IS NULL) = ("preview_builds"."node_version" IS NULL) AND ("preview_builds"."artifact" IS NULL) = ("preview_builds"."package_manager" IS NULL)),
	CONSTRAINT "preview_builds_artifact_attempt" CHECK("preview_builds"."artifact_attempt" IS NULL OR "preview_builds"."artifact_attempt" BETWEEN 1 AND "preview_builds"."attempt"),
	CONSTRAINT "preview_builds_artifact_entry" CHECK("preview_builds"."artifact_entry" IS NULL OR (json_valid("preview_builds"."artifact_entry") AND json_type("preview_builds"."artifact_entry") = 'object')),
	CONSTRAINT "preview_builds_sizes" CHECK(("preview_builds"."output_bytes" IS NULL OR "preview_builds"."output_bytes" >= 0) AND ("preview_builds"."build_ms" IS NULL OR "preview_builds"."build_ms" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_builds_public_id_unique` ON `preview_builds` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `preview_builds_identity` ON `preview_builds` (`repository_source_id`,`commit_sha`,`package_dir`) WHERE "preview_builds"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `preview_builds_source` ON `preview_builds` (`repository_source_id`,`created_at`);--> statement-breakpoint
-- A preparation is always of the Repository and commit it was created for.
CREATE TRIGGER preview_preparations_identity_fixed
BEFORE UPDATE ON preview_preparations
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.repository_source_id IS NOT OLD.repository_source_id OR NEW.commit_sha IS NOT OLD.commit_sha
  OR NEW.ref_name IS NOT OLD.ref_name OR NEW.ref_kind IS NOT OLD.ref_kind OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'preview_preparations: a preparation keeps its Repository, commit, and ref');
END;
--> statement-breakpoint
-- A build exists only for a package of a commit whose preparation decided some package qualifies.
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
CREATE TRIGGER preview_builds_initial_attempt
BEFORE INSERT ON preview_builds
WHEN NEW.attempt IS NOT 1 OR NEW.attempt_state IS NOT 'queued' OR NEW.artifact IS NOT NULL OR NEW.deleted_at IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'preview_builds: a new preview starts with its first attempt queued and nothing published');
END;
--> statement-breakpoint
CREATE TRIGGER preview_builds_identity_fixed
BEFORE UPDATE ON preview_builds
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.repository_source_id IS NOT OLD.repository_source_id OR NEW.preparation_id IS NOT OLD.preparation_id
  OR NEW.commit_sha IS NOT OLD.commit_sha OR NEW.package_dir IS NOT OLD.package_dir OR NEW.ref_name IS NOT OLD.ref_name OR NEW.ref_kind IS NOT OLD.ref_kind
  OR NEW.profile_digest IS NOT OLD.profile_digest OR NEW.deciding_facts IS NOT OLD.deciding_facts OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'preview_builds: a preview keeps its Repository, commit, package, ref, and deciding facts');
END;
--> statement-breakpoint
-- Attempts only move forward, so an earlier attempt can never become current again.
CREATE TRIGGER preview_builds_attempt_forward
BEFORE UPDATE OF attempt ON preview_builds
WHEN NEW.attempt < OLD.attempt
BEGIN
	SELECT RAISE(ABORT, 'preview_builds: attempts are numbered forward');
END;
--> statement-breakpoint
-- Deleting or pruning a preview is final: no late attempt can publish to it or restore it.
CREATE TRIGGER preview_builds_deletion_final
BEFORE UPDATE ON preview_builds
WHEN OLD.deleted_at IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'preview_builds: a deleted preview stays deleted and is never changed');
END;
