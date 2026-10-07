-- Revision format versions (simplify-web-onboarding design decision 3).
-- Portal, Application, and MFE revisions gain a format version: every row
-- stored until now is version 1 and keeps its values, digests, and frozen
-- rows; every revision written from now on is version 2, which holds only
-- what the Portal and Application teams decide. The tables whose checks
-- change are rebuilt with SQLite's documented procedure: migrateDatabase
-- runs migrations with foreign-key enforcement off, legacy_alter_table keeps
-- the rename from rewriting other tables' references, and the next migration
-- recreates the triggers a rebuild drops and checks every foreign key.
CREATE TABLE `environment_catalog_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`outcome` text NOT NULL,
	`contract_digest` text NOT NULL,
	`environments` text,
	`environments_digest` text,
	`error` text,
	`read_at` integer NOT NULL,
	CONSTRAINT "environment_catalog_reads_outcome" CHECK(outcome IN ('found', 'incompatible', 'unavailable')),
	CONSTRAINT "environment_catalog_reads_contract_digest" CHECK(length("environment_catalog_reads"."contract_digest") = 64 AND "environment_catalog_reads"."contract_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "environment_catalog_reads_found" CHECK(CASE "environment_catalog_reads"."outcome" WHEN 'found' THEN "environment_catalog_reads"."environments" IS NOT NULL AND json_valid("environment_catalog_reads"."environments") AND json_type("environment_catalog_reads"."environments") = 'array' AND length("environment_catalog_reads"."environments") <= 262144 AND "environment_catalog_reads"."environments_digest" IS NOT NULL AND length("environment_catalog_reads"."environments_digest") = 64 AND "environment_catalog_reads"."environments_digest" NOT GLOB '*[^0-9a-f]*' AND "environment_catalog_reads"."error" IS NULL
        ELSE "environment_catalog_reads"."environments" IS NULL AND "environment_catalog_reads"."environments_digest" IS NULL AND "environment_catalog_reads"."error" IS NOT NULL AND length("environment_catalog_reads"."error") BETWEEN 1 AND 500 END)
);
--> statement-breakpoint
CREATE INDEX `environment_catalog_reads_read_at` ON `environment_catalog_reads` (`read_at`);--> statement-breakpoint
PRAGMA legacy_alter_table=ON;--> statement-breakpoint
CREATE TABLE `__new_application_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`document` text NOT NULL,
	`digest` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_by` text,
	`submitted_at` integer,
	`format_version` integer DEFAULT 2 NOT NULL,
	`application_id` integer NOT NULL,
	`based_on_revision_id` integer,
	`name` text,
	`owner_team` text,
	`seal_id` text,
	`required_capabilities` text,
	`environment_catalog_source` text,
	`environment_catalog_digest` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_revisions_number" CHECK("number" >= 1),
	CONSTRAINT "application_revisions_state" CHECK(state IN ('draft', 'submitted')),
	CONSTRAINT "application_revisions_format_version" CHECK(format_version IN (1, 2)),
	CONSTRAINT "application_revisions_document" CHECK(json_valid("document") AND json_type("document") = 'object' AND length("document") <= 262144),
	CONSTRAINT "application_revisions_created_by" CHECK(length(trim("created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "application_revisions_submission" CHECK(CASE "state"
      WHEN 'submitted' THEN "digest" IS NOT NULL AND length("digest") = 64 AND "digest" NOT GLOB '*[^0-9a-f]*' AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND length(trim("submitted_by")) BETWEEN 1 AND 200
      ELSE "digest" IS NULL AND "submitted_at" IS NULL AND "submitted_by" IS NULL END),
	CONSTRAINT "application_revisions_seal_id" CHECK("seal_id" IS NULL OR (length("seal_id") BETWEEN 1 AND 64 AND "seal_id" = trim("seal_id"))),
	CONSTRAINT "application_revisions_name" CHECK("name" IS NULL OR length(trim("name")) BETWEEN 1 AND 200),
	CONSTRAINT "application_revisions_owner_team" CHECK("owner_team" IS NULL OR length(trim("owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "application_revisions_frozen" CHECK(CASE "state" WHEN 'submitted' THEN "name" IS NOT NULL AND "owner_team" IS NOT NULL AND CASE "format_version"
          WHEN 1 THEN "required_capabilities" IS NOT NULL AND json_valid("required_capabilities") AND json_type("required_capabilities") = 'array' AND "environment_catalog_source" IS NULL AND "environment_catalog_digest" IS NULL
          WHEN 2 THEN "required_capabilities" IS NULL AND "environment_catalog_source" IN ('studio', 'fallback') AND "environment_catalog_digest" IS NOT NULL AND length("environment_catalog_digest") = 64 AND "environment_catalog_digest" NOT GLOB '*[^0-9a-f]*'
          ELSE 0 END
        ELSE "required_capabilities" IS NULL AND "environment_catalog_source" IS NULL AND "environment_catalog_digest" IS NULL END)
);
--> statement-breakpoint
INSERT INTO `__new_application_revisions`("id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", "format_version", "application_id", "based_on_revision_id", "name", "owner_team", "seal_id", "required_capabilities", "environment_catalog_source", "environment_catalog_digest") SELECT "id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", 1, "application_id", "based_on_revision_id", "name", "owner_team", "seal_id", "required_capabilities", NULL, NULL FROM `application_revisions`;--> statement-breakpoint
DROP TABLE `application_revisions`;--> statement-breakpoint
ALTER TABLE `__new_application_revisions` RENAME TO `application_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `application_revisions_number` ON `application_revisions` (`application_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_revisions_one_draft` ON `application_revisions` (`application_id`) WHERE "application_revisions"."state" = 'draft';--> statement-breakpoint
CREATE TABLE `__new_microfrontend_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`document` text NOT NULL,
	`digest` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_by` text,
	`submitted_at` integer,
	`format_version` integer DEFAULT 2 NOT NULL,
	`microfrontend_id` integer NOT NULL,
	`based_on_revision_id` integer,
	`name` text,
	`owner_team` text,
	`seal_id` text,
	`repository_source_id` integer,
	`workspace_path` text,
	`cdaas_app_id` text,
	`cdaas_view_id` text,
	`contract` text,
	`contract_digest` text,
	`rendering` text,
	FOREIGN KEY (`microfrontend_id`) REFERENCES `microfrontends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `microfrontend_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "microfrontend_revisions_number" CHECK("number" >= 1),
	CONSTRAINT "microfrontend_revisions_state" CHECK(state IN ('draft', 'submitted')),
	CONSTRAINT "microfrontend_revisions_format_version" CHECK(format_version IN (1, 2)),
	CONSTRAINT "microfrontend_revisions_document" CHECK(json_valid("document") AND json_type("document") = 'object' AND length("document") <= 262144),
	CONSTRAINT "microfrontend_revisions_created_by" CHECK(length(trim("created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontend_revisions_submission" CHECK(CASE "state"
      WHEN 'submitted' THEN "digest" IS NOT NULL AND length("digest") = 64 AND "digest" NOT GLOB '*[^0-9a-f]*' AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND length(trim("submitted_by")) BETWEEN 1 AND 200
      ELSE "digest" IS NULL AND "submitted_at" IS NULL AND "submitted_by" IS NULL END),
	CONSTRAINT "microfrontend_revisions_seal_id" CHECK("seal_id" IS NULL OR (length("seal_id") BETWEEN 1 AND 64 AND "seal_id" = trim("seal_id"))),
	CONSTRAINT "microfrontend_revisions_name" CHECK("name" IS NULL OR length(trim("name")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontend_revisions_owner_team" CHECK("owner_team" IS NULL OR length(trim("owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontend_revisions_workspace_path" CHECK("workspace_path" IS NULL OR (length("workspace_path") BETWEEN 1 AND 200 AND "workspace_path" NOT GLOB '/*' AND "workspace_path" NOT GLOB '*/' AND instr("workspace_path", '//') = 0
    AND ('/' || "workspace_path" || '/') NOT GLOB '*/./*' AND ('/' || "workspace_path" || '/') NOT GLOB '*/../*' AND "workspace_path" NOT GLOB '*[^A-Za-z0-9._@/-]*')),
	CONSTRAINT "microfrontend_revisions_cdaas" CHECK(("cdaas_app_id" IS NULL) = ("cdaas_view_id" IS NULL) AND ("cdaas_app_id" IS NULL OR (length("cdaas_app_id") BETWEEN 1 AND 128 AND "cdaas_app_id" NOT GLOB '*[^A-Za-z0-9._:/-]*' AND length("cdaas_view_id") BETWEEN 1 AND 128 AND "cdaas_view_id" NOT GLOB '*[^A-Za-z0-9._:/-]*'))),
	CONSTRAINT "microfrontend_revisions_frozen" CHECK(CASE "state" WHEN 'submitted' THEN "name" IS NOT NULL AND "owner_team" IS NOT NULL AND "repository_source_id" IS NOT NULL AND CASE "format_version"
          WHEN 1 THEN "contract" IS NOT NULL AND json_valid("contract") AND "contract_digest" IS NOT NULL AND length("contract_digest") = 64 AND "contract_digest" NOT GLOB '*[^0-9a-f]*' AND "rendering" IS NULL
          WHEN 2 THEN "rendering" IS NOT NULL AND json_valid("rendering") AND json_type("rendering") = 'object' AND length("rendering") <= 262144 AND "contract" IS NULL AND "contract_digest" IS NULL
          ELSE 0 END
        ELSE "repository_source_id" IS NULL AND "workspace_path" IS NULL AND "cdaas_app_id" IS NULL AND "contract" IS NULL AND "contract_digest" IS NULL AND "rendering" IS NULL END)
);
--> statement-breakpoint
INSERT INTO `__new_microfrontend_revisions`("id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", "format_version", "microfrontend_id", "based_on_revision_id", "name", "owner_team", "seal_id", "repository_source_id", "workspace_path", "cdaas_app_id", "cdaas_view_id", "contract", "contract_digest", "rendering") SELECT "id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", 1, "microfrontend_id", "based_on_revision_id", "name", "owner_team", "seal_id", "repository_source_id", "workspace_path", "cdaas_app_id", "cdaas_view_id", "contract", "contract_digest", NULL FROM `microfrontend_revisions`;--> statement-breakpoint
DROP TABLE `microfrontend_revisions`;--> statement-breakpoint
ALTER TABLE `__new_microfrontend_revisions` RENAME TO `microfrontend_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `microfrontend_revisions_number` ON `microfrontend_revisions` (`microfrontend_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `microfrontend_revisions_one_draft` ON `microfrontend_revisions` (`microfrontend_id`) WHERE "microfrontend_revisions"."state" = 'draft';--> statement-breakpoint
CREATE INDEX `microfrontend_revisions_repository` ON `microfrontend_revisions` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `__new_portal_environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portal_revision_id` integer NOT NULL,
	`environment` text NOT NULL,
	`runtime` text,
	`enabled` integer NOT NULL,
	`entitlements` text,
	`entitlements_digest` text,
	`entitlements_inherited_from` text,
	FOREIGN KEY (`portal_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_environments_environment" CHECK(length("environment") BETWEEN 1 AND 32 AND "environment" GLOB '[a-z]*' AND "environment" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "portal_environments_runtime" CHECK("runtime" IS NULL OR (length("runtime") BETWEEN 1 AND 64 AND "runtime" NOT GLOB '*[^A-Za-z0-9._@/-]*')),
	CONSTRAINT "portal_environments_enabled" CHECK("enabled" IN (0, 1)),
	CONSTRAINT "portal_environments_entitlements" CHECK("entitlements" IS NULL OR (json_valid("entitlements") AND json_type("entitlements") = 'object' AND length("entitlements") <= 262144)),
	CONSTRAINT "portal_environments_entitlements_digest" CHECK("entitlements_digest" IS NULL OR (length("entitlements_digest") = 64 AND "entitlements_digest" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "portal_environments_inherited" CHECK("entitlements_inherited_from" IS NULL OR (length("entitlements_inherited_from") BETWEEN 1 AND 32 AND "entitlements_inherited_from" GLOB '[a-z]*' AND "entitlements_inherited_from" NOT GLOB '*[^a-z0-9-]*' AND "entitlements_inherited_from" <> "environment")),
	CONSTRAINT "portal_environments_legacy" CHECK(("runtime" IS NULL) = ("entitlements" IS NULL) AND ("entitlements" IS NULL) = ("entitlements_digest" IS NULL) AND ("entitlements" IS NOT NULL OR "entitlements_inherited_from" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_portal_environments`("id", "portal_revision_id", "environment", "runtime", "enabled", "entitlements", "entitlements_digest", "entitlements_inherited_from") SELECT "id", "portal_revision_id", "environment", "runtime", "enabled", "entitlements", "entitlements_digest", "entitlements_inherited_from" FROM `portal_environments`;--> statement-breakpoint
DROP TABLE `portal_environments`;--> statement-breakpoint
ALTER TABLE `__new_portal_environments` RENAME TO `portal_environments`;--> statement-breakpoint
CREATE UNIQUE INDEX `portal_environments_environment` ON `portal_environments` (`portal_revision_id`,`environment`);--> statement-breakpoint
CREATE TABLE `__new_portal_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`document` text NOT NULL,
	`digest` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_by` text,
	`submitted_at` integer,
	`format_version` integer DEFAULT 2 NOT NULL,
	`portal_id` integer NOT NULL,
	`based_on_revision_id` integer,
	`owner_team` text,
	`seal_id` text,
	`runtimes` text,
	`contract` text,
	`contract_digest` text,
	`environment_catalog_source` text,
	`environment_catalog_digest` text,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_revisions_number" CHECK("number" >= 1),
	CONSTRAINT "portal_revisions_state" CHECK(state IN ('draft', 'submitted')),
	CONSTRAINT "portal_revisions_format_version" CHECK(format_version IN (1, 2)),
	CONSTRAINT "portal_revisions_document" CHECK(json_valid("document") AND json_type("document") = 'object' AND length("document") <= 262144),
	CONSTRAINT "portal_revisions_created_by" CHECK(length(trim("created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "portal_revisions_submission" CHECK(CASE "state"
      WHEN 'submitted' THEN "digest" IS NOT NULL AND length("digest") = 64 AND "digest" NOT GLOB '*[^0-9a-f]*' AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND length(trim("submitted_by")) BETWEEN 1 AND 200
      ELSE "digest" IS NULL AND "submitted_at" IS NULL AND "submitted_by" IS NULL END),
	CONSTRAINT "portal_revisions_seal_id" CHECK("seal_id" IS NULL OR (length("seal_id") BETWEEN 1 AND 64 AND "seal_id" = trim("seal_id"))),
	CONSTRAINT "portal_revisions_owner_team" CHECK("owner_team" IS NULL OR length(trim("owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "portal_revisions_frozen" CHECK(CASE "state" WHEN 'submitted' THEN "owner_team" IS NOT NULL AND CASE "format_version"
          WHEN 1 THEN "runtimes" IS NOT NULL AND json_valid("runtimes") AND json_type("runtimes") = 'array'
            AND "contract" IS NOT NULL AND json_valid("contract") AND "contract_digest" IS NOT NULL AND length("contract_digest") = 64 AND "contract_digest" NOT GLOB '*[^0-9a-f]*' AND "environment_catalog_source" IS NULL AND "environment_catalog_digest" IS NULL
          WHEN 2 THEN "runtimes" IS NULL AND "contract" IS NULL AND "contract_digest" IS NULL AND "environment_catalog_source" IN ('studio', 'fallback') AND "environment_catalog_digest" IS NOT NULL AND length("environment_catalog_digest") = 64 AND "environment_catalog_digest" NOT GLOB '*[^0-9a-f]*'
          ELSE 0 END
        ELSE "runtimes" IS NULL AND "contract" IS NULL AND "contract_digest" IS NULL AND "environment_catalog_source" IS NULL AND "environment_catalog_digest" IS NULL END)
);
--> statement-breakpoint
INSERT INTO `__new_portal_revisions`("id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", "format_version", "portal_id", "based_on_revision_id", "owner_team", "seal_id", "runtimes", "contract", "contract_digest", "environment_catalog_source", "environment_catalog_digest") SELECT "id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", 1, "portal_id", "based_on_revision_id", "owner_team", "seal_id", "runtimes", "contract", "contract_digest", NULL, NULL FROM `portal_revisions`;--> statement-breakpoint
DROP TABLE `portal_revisions`;--> statement-breakpoint
ALTER TABLE `__new_portal_revisions` RENAME TO `portal_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `portal_revisions_number` ON `portal_revisions` (`portal_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_revisions_one_draft` ON `portal_revisions` (`portal_id`) WHERE "portal_revisions"."state" = 'draft';--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
-- A child binding names the module its host mounts. Added in place: the bindings keep their rows and triggers.
ALTER TABLE `application_components` ADD COLUMN `module` text CONSTRAINT "application_components_module" CHECK(`module` IS NULL OR length(trim(`module`)) BETWEEN 1 AND 200);
