CREATE TABLE `application_components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_revision_id` integer NOT NULL,
	`microfrontend_id` integer NOT NULL,
	`role` text NOT NULL,
	`mount_kind` text,
	`mount_key` text,
	`required` integer NOT NULL,
	`host_configuration` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`microfrontend_id`) REFERENCES `microfrontends`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_components_role" CHECK(role IN ('entry', 'child')),
	CONSTRAINT "application_components_mount" CHECK(CASE "application_components"."role"
        WHEN 'entry' THEN "application_components"."mount_kind" IS NULL AND "application_components"."mount_key" IS NULL AND "application_components"."required" = 1
        WHEN 'child' THEN "application_components"."mount_kind" IS NOT NULL AND "application_components"."mount_key" IS NOT NULL AND "application_components"."mount_kind" IN ('route', 'slot') AND length("application_components"."mount_key") BETWEEN 1 AND 200
          AND CASE "application_components"."mount_kind" WHEN 'route' THEN length("application_components"."mount_key") BETWEEN 1 AND 200 AND "application_components"."mount_key" GLOB '/*' AND instr("application_components"."mount_key", '//') = 0 AND ("application_components"."mount_key" = '/' OR "application_components"."mount_key" NOT GLOB '*/') AND "application_components"."mount_key" NOT GLOB '*[?#]*' AND "application_components"."mount_key" NOT GLOB '*[^!-~]*' ELSE length("application_components"."mount_key") BETWEEN 1 AND 64 AND "application_components"."mount_key" GLOB '[a-z]*' AND "application_components"."mount_key" NOT GLOB '*[^a-z0-9-]*' END
        ELSE 0 END),
	CONSTRAINT "application_components_required" CHECK("application_components"."required" IN (0, 1)),
	CONSTRAINT "application_components_host_configuration" CHECK(json_valid("application_components"."host_configuration") AND json_type("application_components"."host_configuration") = 'object' AND length("application_components"."host_configuration") <= 262144)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_components_microfrontend` ON `application_components` (`application_revision_id`,`microfrontend_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_components_one_entry` ON `application_components` (`application_revision_id`) WHERE "application_components"."role" = 'entry';--> statement-breakpoint
CREATE UNIQUE INDEX `application_components_mount` ON `application_components` (`application_revision_id`,`mount_kind`,`mount_key`) WHERE "application_components"."role" = 'child';--> statement-breakpoint
CREATE INDEX `application_components_microfrontend_uses` ON `application_components` (`microfrontend_id`);--> statement-breakpoint
CREATE TABLE `application_environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_revision_id` integer NOT NULL,
	`environment` text NOT NULL,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_environments_environment" CHECK(length("application_environments"."environment") BETWEEN 1 AND 32 AND "application_environments"."environment" GLOB '[a-z]*' AND "application_environments"."environment" NOT GLOB '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_environments_environment` ON `application_environments` (`application_revision_id`,`environment`);--> statement-breakpoint
CREATE TABLE `application_launch_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_revision_id` integer NOT NULL,
	`kind` text NOT NULL,
	`microfrontend_id` integer,
	`rendering_mode` text NOT NULL,
	`document_url` text,
	`module_url` text,
	`exported_module` text,
	`manifest_url` text,
	`exposed_module` text,
	`configuration` text DEFAULT '{}' NOT NULL,
	`host_contract` text,
	`host_contract_digest` text,
	`confirmation` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`microfrontend_id`) REFERENCES `microfrontends`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_launch_targets_kind" CHECK(kind IN ('mfe', 'external')),
	CONSTRAINT "application_launch_targets_rendering_mode" CHECK(rendering_mode IN ('iframe', 'esm', 'module_federation_2')),
	CONSTRAINT "application_launch_targets_confirmation" CHECK(confirmation IN ('inferred', 'override', 'explicit')),
	CONSTRAINT "application_launch_targets_confirmed_by" CHECK(length(trim("application_launch_targets"."confirmed_by")) BETWEEN 1 AND 200),
	CONSTRAINT "application_launch_targets_urls" CHECK(("application_launch_targets"."document_url" IS NULL OR (length("application_launch_targets"."document_url") BETWEEN 9 AND 2048 AND "application_launch_targets"."document_url" GLOB 'https://?*' AND instr("application_launch_targets"."document_url", '#') = 0 AND instr(CASE WHEN instr(substr("application_launch_targets"."document_url", 9), '/') > 0 THEN substr(substr("application_launch_targets"."document_url", 9), 1, instr(substr("application_launch_targets"."document_url", 9), '/') - 1) ELSE substr("application_launch_targets"."document_url", 9) END, '@') = 0 AND "application_launch_targets"."document_url" NOT GLOB '*[^!-~]*')) AND ("application_launch_targets"."module_url" IS NULL OR (length("application_launch_targets"."module_url") BETWEEN 9 AND 2048 AND "application_launch_targets"."module_url" GLOB 'https://?*' AND instr("application_launch_targets"."module_url", '#') = 0 AND instr(CASE WHEN instr(substr("application_launch_targets"."module_url", 9), '/') > 0 THEN substr(substr("application_launch_targets"."module_url", 9), 1, instr(substr("application_launch_targets"."module_url", 9), '/') - 1) ELSE substr("application_launch_targets"."module_url", 9) END, '@') = 0 AND "application_launch_targets"."module_url" NOT GLOB '*[^!-~]*')) AND ("application_launch_targets"."manifest_url" IS NULL OR (length("application_launch_targets"."manifest_url") BETWEEN 9 AND 2048 AND "application_launch_targets"."manifest_url" GLOB 'https://?*' AND instr("application_launch_targets"."manifest_url", '#') = 0 AND instr(CASE WHEN instr(substr("application_launch_targets"."manifest_url", 9), '/') > 0 THEN substr(substr("application_launch_targets"."manifest_url", 9), 1, instr(substr("application_launch_targets"."manifest_url", 9), '/') - 1) ELSE substr("application_launch_targets"."manifest_url", 9) END, '@') = 0 AND "application_launch_targets"."manifest_url" NOT GLOB '*[^!-~]*'))),
	CONSTRAINT "application_launch_targets_modules" CHECK(("application_launch_targets"."exported_module" IS NULL OR length(trim("application_launch_targets"."exported_module")) BETWEEN 1 AND 200) AND ("application_launch_targets"."exposed_module" IS NULL OR length(trim("application_launch_targets"."exposed_module")) BETWEEN 1 AND 200)),
	CONSTRAINT "application_launch_targets_configuration" CHECK(json_valid("application_launch_targets"."configuration") AND json_type("application_launch_targets"."configuration") = 'object' AND length("application_launch_targets"."configuration") <= 262144),
	CONSTRAINT "application_launch_targets_source" CHECK(CASE "application_launch_targets"."kind"
        WHEN 'mfe' THEN "application_launch_targets"."microfrontend_id" IS NOT NULL AND "application_launch_targets"."document_url" IS NULL AND "application_launch_targets"."module_url" IS NULL AND "application_launch_targets"."manifest_url" IS NULL AND "application_launch_targets"."host_contract" IS NULL
          AND CASE "application_launch_targets"."rendering_mode" WHEN 'iframe' THEN "application_launch_targets"."exported_module" IS NULL AND "application_launch_targets"."exposed_module" IS NULL
            WHEN 'esm' THEN "application_launch_targets"."exposed_module" IS NULL WHEN 'module_federation_2' THEN "application_launch_targets"."exported_module" IS NULL ELSE 0 END
        WHEN 'external' THEN "application_launch_targets"."microfrontend_id" IS NULL
          AND CASE "application_launch_targets"."rendering_mode"
            WHEN 'iframe' THEN "application_launch_targets"."document_url" IS NOT NULL AND "application_launch_targets"."module_url" IS NULL AND "application_launch_targets"."exported_module" IS NULL AND "application_launch_targets"."manifest_url" IS NULL AND "application_launch_targets"."exposed_module" IS NULL
            WHEN 'esm' THEN "application_launch_targets"."module_url" IS NOT NULL AND "application_launch_targets"."exported_module" IS NOT NULL AND "application_launch_targets"."document_url" IS NULL AND "application_launch_targets"."manifest_url" IS NULL AND "application_launch_targets"."exposed_module" IS NULL
            WHEN 'module_federation_2' THEN "application_launch_targets"."manifest_url" IS NOT NULL AND "application_launch_targets"."exposed_module" IS NOT NULL AND "application_launch_targets"."document_url" IS NULL AND "application_launch_targets"."module_url" IS NULL AND "application_launch_targets"."exported_module" IS NULL
            ELSE 0 END
        ELSE 0 END),
	CONSTRAINT "application_launch_targets_host_contract" CHECK(("application_launch_targets"."host_contract" IS NULL) = ("application_launch_targets"."host_contract_digest" IS NULL) AND ("application_launch_targets"."host_contract" IS NULL OR (json_valid("application_launch_targets"."host_contract") AND json_type("application_launch_targets"."host_contract") = 'object' AND length("application_launch_targets"."host_contract") <= 262144 AND length("application_launch_targets"."host_contract_digest") = 64 AND "application_launch_targets"."host_contract_digest" NOT GLOB '*[^0-9a-f]*')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_launch_targets_application_revision_id_unique` ON `application_launch_targets` (`application_revision_id`);--> statement-breakpoint
CREATE INDEX `application_launch_targets_microfrontend` ON `application_launch_targets` (`microfrontend_id`);--> statement-breakpoint
CREATE TABLE `application_placements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`application_id` integer NOT NULL,
	`portal_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_placements_public_id" CHECK("application_placements"."public_id" GLOB 'plc_*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_placements_public_id_unique` ON `application_placements` (`public_id`);--> statement-breakpoint
CREATE INDEX `application_placements_application` ON `application_placements` (`application_id`);--> statement-breakpoint
CREATE INDEX `application_placements_portal` ON `application_placements` (`portal_id`);--> statement-breakpoint
CREATE TABLE `application_revisions` (
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
	`application_id` integer NOT NULL,
	`based_on_revision_id` integer,
	`name` text,
	`owner_team` text,
	`seal_id` text,
	`required_capabilities` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_revisions_number" CHECK("application_revisions"."number" >= 1),
	CONSTRAINT "application_revisions_state" CHECK(state IN ('draft', 'submitted')),
	CONSTRAINT "application_revisions_document" CHECK(json_valid("application_revisions"."document") AND json_type("application_revisions"."document") = 'object' AND length("application_revisions"."document") <= 262144),
	CONSTRAINT "application_revisions_created_by" CHECK(length(trim("application_revisions"."created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "application_revisions_submission" CHECK(CASE "application_revisions"."state"
      WHEN 'submitted' THEN "application_revisions"."digest" IS NOT NULL AND length("application_revisions"."digest") = 64 AND "application_revisions"."digest" NOT GLOB '*[^0-9a-f]*' AND "application_revisions"."submitted_at" IS NOT NULL AND "application_revisions"."submitted_by" IS NOT NULL AND length(trim("application_revisions"."submitted_by")) BETWEEN 1 AND 200
      ELSE "application_revisions"."digest" IS NULL AND "application_revisions"."submitted_at" IS NULL AND "application_revisions"."submitted_by" IS NULL END),
	CONSTRAINT "application_revisions_seal_id" CHECK("application_revisions"."seal_id" IS NULL OR (length("application_revisions"."seal_id") BETWEEN 1 AND 64 AND "application_revisions"."seal_id" = trim("application_revisions"."seal_id"))),
	CONSTRAINT "application_revisions_name" CHECK("application_revisions"."name" IS NULL OR length(trim("application_revisions"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "application_revisions_owner_team" CHECK("application_revisions"."owner_team" IS NULL OR length(trim("application_revisions"."owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "application_revisions_frozen" CHECK(CASE "application_revisions"."state" WHEN 'submitted' THEN "application_revisions"."name" IS NOT NULL AND "application_revisions"."owner_team" IS NOT NULL AND "application_revisions"."required_capabilities" IS NOT NULL AND json_valid("application_revisions"."required_capabilities") AND json_type("application_revisions"."required_capabilities") = 'array'
        ELSE "application_revisions"."required_capabilities" IS NULL END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_revisions_number` ON `application_revisions` (`application_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_revisions_one_draft` ON `application_revisions` (`application_id`) WHERE "application_revisions"."state" = 'draft';--> statement-breakpoint
CREATE TABLE `external_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference_id` integer NOT NULL,
	`outcome` text NOT NULL,
	`contract_digest` text NOT NULL,
	`projection` text,
	`projection_digest` text NOT NULL,
	`first_observed_at` integer NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `external_references`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_observations_outcome" CHECK(outcome IN ('found', 'not_found', 'incompatible')),
	CONSTRAINT "external_observations_contract_digest" CHECK(length("external_observations"."contract_digest") = 64 AND "external_observations"."contract_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "external_observations_projection_digest" CHECK(length("external_observations"."projection_digest") = 64 AND "external_observations"."projection_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "external_observations_projection" CHECK(CASE "external_observations"."outcome" WHEN 'found' THEN "external_observations"."projection" IS NOT NULL AND json_valid("external_observations"."projection") AND json_type("external_observations"."projection") = 'object' AND length("external_observations"."projection") <= 262144 ELSE "external_observations"."projection" IS NULL END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_observations_state` ON `external_observations` (`reference_id`,`outcome`,`contract_digest`,`projection_digest`);--> statement-breakpoint
CREATE TABLE `external_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference_id` integer NOT NULL,
	`observation_id` integer,
	`outcome` text NOT NULL,
	`error` text,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `external_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`observation_id`) REFERENCES `external_observations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_reads_outcome" CHECK(outcome IN ('found', 'not_found', 'incompatible', 'unavailable')),
	CONSTRAINT "external_reads_observation" CHECK(("external_reads"."outcome" = 'unavailable') = ("external_reads"."observation_id" IS NULL)),
	CONSTRAINT "external_reads_error" CHECK(CASE WHEN "external_reads"."outcome" IN ('unavailable', 'incompatible') THEN "external_reads"."error" IS NOT NULL AND length("external_reads"."error") BETWEEN 1 AND 500 ELSE "external_reads"."error" IS NULL END)
);
--> statement-breakpoint
CREATE INDEX `external_reads_reference` ON `external_reads` (`reference_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `external_references` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`system` text NOT NULL,
	`resource_type` text NOT NULL,
	`external_id` text NOT NULL,
	`environment` text,
	`portal_id` integer,
	`application_id` integer,
	`microfrontend_id` integer,
	`placement_id` integer,
	`subject` text NOT NULL,
	`source` text NOT NULL,
	`provided_by` text NOT NULL,
	`attribution` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`microfrontend_id`) REFERENCES `microfrontends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`placement_id`) REFERENCES `application_placements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_references_public_id" CHECK("external_references"."public_id" GLOB 'xrf_*'),
	CONSTRAINT "external_references_system" CHECK(system IN ('studio', 'cdaas')),
	CONSTRAINT "external_references_resource_type" CHECK(resource_type IN ('channel', 'module_group', 'module', 'menu', 'environment', 'application_view')),
	CONSTRAINT "external_references_external_id" CHECK(length("external_references"."external_id") BETWEEN 1 AND 128 AND "external_references"."external_id" NOT GLOB '*[^A-Za-z0-9._:/-]*'),
	CONSTRAINT "external_references_environment" CHECK("external_references"."environment" IS NULL OR length("external_references"."environment") BETWEEN 1 AND 32 AND "external_references"."environment" GLOB '[a-z]*' AND "external_references"."environment" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "external_references_source" CHECK(source IN ('person', 'declared', 'discovered')),
	CONSTRAINT "external_references_subject" CHECK("external_references"."subject" IS CASE
        WHEN "external_references"."portal_id" IS NOT NULL AND "external_references"."application_id" IS NULL AND "external_references"."microfrontend_id" IS NULL AND "external_references"."placement_id" IS NULL THEN 'portal:' || "external_references"."portal_id"
        WHEN "external_references"."application_id" IS NOT NULL AND "external_references"."portal_id" IS NULL AND "external_references"."microfrontend_id" IS NULL AND "external_references"."placement_id" IS NULL THEN 'application:' || "external_references"."application_id"
        WHEN "external_references"."microfrontend_id" IS NOT NULL AND "external_references"."portal_id" IS NULL AND "external_references"."application_id" IS NULL AND "external_references"."placement_id" IS NULL THEN 'microfrontend:' || "external_references"."microfrontend_id"
        WHEN "external_references"."placement_id" IS NOT NULL AND "external_references"."portal_id" IS NULL AND "external_references"."application_id" IS NULL AND "external_references"."microfrontend_id" IS NULL THEN 'placement:' || "external_references"."placement_id"
        END),
	CONSTRAINT "external_references_mapping" CHECK(CASE "external_references"."system"
        WHEN 'studio' THEN ("external_references"."resource_type" = 'channel' AND "external_references"."portal_id" IS NOT NULL) OR ("external_references"."resource_type" = 'module_group' AND "external_references"."application_id" IS NOT NULL)
          OR ("external_references"."resource_type" = 'module' AND "external_references"."microfrontend_id" IS NOT NULL) OR ("external_references"."resource_type" = 'menu' AND "external_references"."placement_id" IS NOT NULL AND "external_references"."environment" IS NOT NULL)
          OR ("external_references"."resource_type" = 'environment' AND "external_references"."portal_id" IS NOT NULL AND "external_references"."environment" IS NOT NULL)
        WHEN 'cdaas' THEN "external_references"."resource_type" = 'application_view' AND "external_references"."microfrontend_id" IS NOT NULL AND "external_references"."external_id" GLOB '?*/?*'
        ELSE 0 END),
	CONSTRAINT "external_references_provided_by" CHECK(length(trim("external_references"."provided_by")) BETWEEN 1 AND 200),
	CONSTRAINT "external_references_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_references_public_id_unique` ON `external_references` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_references_resource` ON `external_references` (`system`,`resource_type`,`external_id`,ifnull(`environment`, '')) WHERE "external_references"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `external_references_subject` ON `external_references` (`subject`,`system`,`resource_type`,ifnull(`environment`, '')) WHERE "external_references"."retired_at" IS NULL;--> statement-breakpoint
CREATE TABLE `microfrontend_revisions` (
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
	FOREIGN KEY (`microfrontend_id`) REFERENCES `microfrontends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `microfrontend_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "microfrontend_revisions_number" CHECK("microfrontend_revisions"."number" >= 1),
	CONSTRAINT "microfrontend_revisions_state" CHECK(state IN ('draft', 'submitted')),
	CONSTRAINT "microfrontend_revisions_document" CHECK(json_valid("microfrontend_revisions"."document") AND json_type("microfrontend_revisions"."document") = 'object' AND length("microfrontend_revisions"."document") <= 262144),
	CONSTRAINT "microfrontend_revisions_created_by" CHECK(length(trim("microfrontend_revisions"."created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontend_revisions_submission" CHECK(CASE "microfrontend_revisions"."state"
      WHEN 'submitted' THEN "microfrontend_revisions"."digest" IS NOT NULL AND length("microfrontend_revisions"."digest") = 64 AND "microfrontend_revisions"."digest" NOT GLOB '*[^0-9a-f]*' AND "microfrontend_revisions"."submitted_at" IS NOT NULL AND "microfrontend_revisions"."submitted_by" IS NOT NULL AND length(trim("microfrontend_revisions"."submitted_by")) BETWEEN 1 AND 200
      ELSE "microfrontend_revisions"."digest" IS NULL AND "microfrontend_revisions"."submitted_at" IS NULL AND "microfrontend_revisions"."submitted_by" IS NULL END),
	CONSTRAINT "microfrontend_revisions_seal_id" CHECK("microfrontend_revisions"."seal_id" IS NULL OR (length("microfrontend_revisions"."seal_id") BETWEEN 1 AND 64 AND "microfrontend_revisions"."seal_id" = trim("microfrontend_revisions"."seal_id"))),
	CONSTRAINT "microfrontend_revisions_name" CHECK("microfrontend_revisions"."name" IS NULL OR length(trim("microfrontend_revisions"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontend_revisions_owner_team" CHECK("microfrontend_revisions"."owner_team" IS NULL OR length(trim("microfrontend_revisions"."owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontend_revisions_workspace_path" CHECK("microfrontend_revisions"."workspace_path" IS NULL OR (length("microfrontend_revisions"."workspace_path") BETWEEN 1 AND 200 AND "microfrontend_revisions"."workspace_path" NOT GLOB '/*' AND "microfrontend_revisions"."workspace_path" NOT GLOB '*/' AND instr("microfrontend_revisions"."workspace_path", '//') = 0
    AND ('/' || "microfrontend_revisions"."workspace_path" || '/') NOT GLOB '*/./*' AND ('/' || "microfrontend_revisions"."workspace_path" || '/') NOT GLOB '*/../*' AND "microfrontend_revisions"."workspace_path" NOT GLOB '*[^A-Za-z0-9._@/-]*')),
	CONSTRAINT "microfrontend_revisions_cdaas" CHECK(("microfrontend_revisions"."cdaas_app_id" IS NULL) = ("microfrontend_revisions"."cdaas_view_id" IS NULL) AND ("microfrontend_revisions"."cdaas_app_id" IS NULL OR (length("microfrontend_revisions"."cdaas_app_id") BETWEEN 1 AND 128 AND "microfrontend_revisions"."cdaas_app_id" NOT GLOB '*[^A-Za-z0-9._:/-]*' AND length("microfrontend_revisions"."cdaas_view_id") BETWEEN 1 AND 128 AND "microfrontend_revisions"."cdaas_view_id" NOT GLOB '*[^A-Za-z0-9._:/-]*'))),
	CONSTRAINT "microfrontend_revisions_frozen" CHECK(CASE "microfrontend_revisions"."state" WHEN 'submitted' THEN "microfrontend_revisions"."name" IS NOT NULL AND "microfrontend_revisions"."owner_team" IS NOT NULL AND "microfrontend_revisions"."repository_source_id" IS NOT NULL
        AND "microfrontend_revisions"."contract" IS NOT NULL AND json_valid("microfrontend_revisions"."contract") AND "microfrontend_revisions"."contract_digest" IS NOT NULL AND length("microfrontend_revisions"."contract_digest") = 64 AND "microfrontend_revisions"."contract_digest" NOT GLOB '*[^0-9a-f]*'
        ELSE "microfrontend_revisions"."repository_source_id" IS NULL AND "microfrontend_revisions"."workspace_path" IS NULL AND "microfrontend_revisions"."cdaas_app_id" IS NULL AND "microfrontend_revisions"."contract" IS NULL AND "microfrontend_revisions"."contract_digest" IS NULL END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microfrontend_revisions_number` ON `microfrontend_revisions` (`microfrontend_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `microfrontend_revisions_one_draft` ON `microfrontend_revisions` (`microfrontend_id`) WHERE "microfrontend_revisions"."state" = 'draft';--> statement-breakpoint
CREATE INDEX `microfrontend_revisions_repository` ON `microfrontend_revisions` (`repository_source_id`);--> statement-breakpoint
CREATE TABLE `microfrontends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`seal_id` text,
	`owner_team` text,
	`lifecycle` text DEFAULT 'draft' NOT NULL,
	`active_revision_id` integer,
	`draft_revision_id` integer,
	`cdaas_app_id` text,
	`cdaas_view_id` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`active_revision_id`) REFERENCES `microfrontend_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`draft_revision_id`) REFERENCES `microfrontend_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "microfrontends_public_id" CHECK("microfrontends"."public_id" GLOB 'mfe_*'),
	CONSTRAINT "microfrontends_name" CHECK(length(trim("microfrontends"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontends_seal_id" CHECK("microfrontends"."seal_id" IS NULL OR (length("microfrontends"."seal_id") BETWEEN 1 AND 64 AND "microfrontends"."seal_id" = trim("microfrontends"."seal_id"))),
	CONSTRAINT "microfrontends_owner_team" CHECK("microfrontends"."owner_team" IS NULL OR length(trim("microfrontends"."owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "microfrontends_lifecycle" CHECK(lifecycle IN ('draft', 'ready', 'active', 'retired')),
	CONSTRAINT "microfrontends_cdaas" CHECK(("microfrontends"."cdaas_app_id" IS NULL) = ("microfrontends"."cdaas_view_id" IS NULL) AND ("microfrontends"."cdaas_app_id" IS NULL OR (length("microfrontends"."cdaas_app_id") BETWEEN 1 AND 128 AND "microfrontends"."cdaas_app_id" NOT GLOB '*[^A-Za-z0-9._:/-]*' AND length("microfrontends"."cdaas_view_id") BETWEEN 1 AND 128 AND "microfrontends"."cdaas_view_id" NOT GLOB '*[^A-Za-z0-9._:/-]*')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microfrontends_public_id_unique` ON `microfrontends` (`public_id`);--> statement-breakpoint
CREATE INDEX `microfrontends_seal_id` ON `microfrontends` (`seal_id`);--> statement-breakpoint
CREATE INDEX `microfrontends_name` ON `microfrontends` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `microfrontends_cdaas_view` ON `microfrontends` (`cdaas_app_id`,`cdaas_view_id`) WHERE "microfrontends"."cdaas_app_id" IS NOT NULL AND "microfrontends"."lifecycle" <> 'retired';--> statement-breakpoint
CREATE TABLE `onboarding_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`portal_id` integer,
	`application_id` integer,
	`microfrontend_id` integer,
	`revision` integer,
	`event` text NOT NULL,
	`from_lifecycle` text,
	`to_lifecycle` text,
	`reason` text,
	`actor` text NOT NULL,
	`attribution` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`microfrontend_id`) REFERENCES `microfrontends`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "onboarding_events_subject" CHECK(CASE "onboarding_events"."subject"
      WHEN 'portal' THEN "onboarding_events"."portal_id" IS NOT NULL AND "onboarding_events"."application_id" IS NULL AND "onboarding_events"."microfrontend_id" IS NULL
      WHEN 'application' THEN "onboarding_events"."application_id" IS NOT NULL AND "onboarding_events"."portal_id" IS NULL AND "onboarding_events"."microfrontend_id" IS NULL
      WHEN 'microfrontend' THEN "onboarding_events"."microfrontend_id" IS NOT NULL AND "onboarding_events"."portal_id" IS NULL AND "onboarding_events"."application_id" IS NULL
      ELSE 0 END),
	CONSTRAINT "onboarding_events_event" CHECK(event IN ('created', 'draft_started', 'submitted', 'ready', 'not_ready', 'activated', 'revision_activated', 'retired', 'metadata_changed')),
	CONSTRAINT "onboarding_events_lifecycle" CHECK((from_lifecycle IS NULL OR from_lifecycle IN ('draft', 'ready', 'active', 'retired')) AND (to_lifecycle IS NULL OR to_lifecycle IN ('draft', 'ready', 'active', 'retired'))),
	CONSTRAINT "onboarding_events_revision" CHECK("onboarding_events"."revision" IS NULL OR "onboarding_events"."revision" >= 1),
	CONSTRAINT "onboarding_events_reason" CHECK(CASE WHEN "onboarding_events"."event" = 'retired' THEN "onboarding_events"."reason" IS NOT NULL AND length(trim("onboarding_events"."reason")) BETWEEN 1 AND 1000 ELSE "onboarding_events"."reason" IS NULL OR length(trim("onboarding_events"."reason")) BETWEEN 1 AND 1000 END),
	CONSTRAINT "onboarding_events_actor" CHECK(length(trim("onboarding_events"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "onboarding_events_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
CREATE INDEX `onboarding_events_portal` ON `onboarding_events` (`portal_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `onboarding_events_application` ON `onboarding_events` (`application_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `onboarding_events_microfrontend` ON `onboarding_events` (`microfrontend_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `onboarding_validations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`portal_revision_id` integer,
	`application_revision_id` integer,
	`microfrontend_revision_id` integer,
	`document_digest` text NOT NULL,
	`blocking` integer NOT NULL,
	`issues` text NOT NULL,
	`evaluated_at` integer NOT NULL,
	FOREIGN KEY (`portal_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`microfrontend_revision_id`) REFERENCES `microfrontend_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "onboarding_validations_subject" CHECK(CASE "onboarding_validations"."subject"
      WHEN 'portal' THEN "onboarding_validations"."portal_revision_id" IS NOT NULL AND "onboarding_validations"."application_revision_id" IS NULL AND "onboarding_validations"."microfrontend_revision_id" IS NULL
      WHEN 'application' THEN "onboarding_validations"."application_revision_id" IS NOT NULL AND "onboarding_validations"."portal_revision_id" IS NULL AND "onboarding_validations"."microfrontend_revision_id" IS NULL
      WHEN 'microfrontend' THEN "onboarding_validations"."microfrontend_revision_id" IS NOT NULL AND "onboarding_validations"."portal_revision_id" IS NULL AND "onboarding_validations"."application_revision_id" IS NULL
      ELSE 0 END),
	CONSTRAINT "onboarding_validations_document_digest" CHECK(length("onboarding_validations"."document_digest") = 64 AND "onboarding_validations"."document_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "onboarding_validations_blocking" CHECK("onboarding_validations"."blocking" >= 0),
	CONSTRAINT "onboarding_validations_issues" CHECK(json_valid("onboarding_validations"."issues") AND json_type("onboarding_validations"."issues") = 'array' AND length("onboarding_validations"."issues") <= 262144)
);
--> statement-breakpoint
CREATE INDEX `onboarding_validations_portal` ON `onboarding_validations` (`portal_revision_id`,`evaluated_at`);--> statement-breakpoint
CREATE INDEX `onboarding_validations_application` ON `onboarding_validations` (`application_revision_id`,`evaluated_at`);--> statement-breakpoint
CREATE INDEX `onboarding_validations_microfrontend` ON `onboarding_validations` (`microfrontend_revision_id`,`evaluated_at`);--> statement-breakpoint
CREATE TABLE `placement_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`placement_id` integer NOT NULL,
	`placement_request_id` integer NOT NULL,
	`portal_revision_id` integer NOT NULL,
	`application_revision_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`accepted_route` text,
	`accepted_menu_parent_key` text,
	`accepted_label` text,
	`accepted_ordering` integer,
	`accepted_entitlements` text,
	`accepted_defaults` text,
	`actor` text NOT NULL,
	`attribution` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`placement_id`) REFERENCES `application_placements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`placement_request_id`) REFERENCES `placement_requests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portal_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "placement_decisions_public_id" CHECK("placement_decisions"."public_id" GLOB 'pdc_*'),
	CONSTRAINT "placement_decisions_sequence" CHECK("placement_decisions"."sequence" >= 0),
	CONSTRAINT "placement_decisions_decision" CHECK(decision IN ('approve', 'reject', 'withdraw', 'retire')),
	CONSTRAINT "placement_decisions_reason" CHECK(CASE WHEN "placement_decisions"."decision" IN ('reject', 'retire') THEN "placement_decisions"."reason" IS NOT NULL AND length(trim("placement_decisions"."reason")) BETWEEN 1 AND 1000 ELSE "placement_decisions"."reason" IS NULL OR length(trim("placement_decisions"."reason")) BETWEEN 1 AND 1000 END),
	CONSTRAINT "placement_decisions_accepted" CHECK(CASE "placement_decisions"."decision"
        WHEN 'approve' THEN "placement_decisions"."accepted_route" IS NOT NULL AND length("placement_decisions"."accepted_route") BETWEEN 1 AND 200 AND "placement_decisions"."accepted_route" GLOB '/*' AND instr("placement_decisions"."accepted_route", '//') = 0 AND ("placement_decisions"."accepted_route" = '/' OR "placement_decisions"."accepted_route" NOT GLOB '*/') AND "placement_decisions"."accepted_route" NOT GLOB '*[?#]*' AND "placement_decisions"."accepted_route" NOT GLOB '*[^!-~]*' AND "placement_decisions"."accepted_label" IS NOT NULL AND length(trim("placement_decisions"."accepted_label")) BETWEEN 1 AND 100
          AND "placement_decisions"."accepted_ordering" IS NOT NULL AND "placement_decisions"."accepted_ordering" BETWEEN 0 AND 100000 AND ("placement_decisions"."accepted_menu_parent_key" IS NULL OR length("placement_decisions"."accepted_menu_parent_key") BETWEEN 1 AND 64 AND "placement_decisions"."accepted_menu_parent_key" GLOB '[a-z]*' AND "placement_decisions"."accepted_menu_parent_key" NOT GLOB '*[^a-z0-9-]*')
          AND "placement_decisions"."accepted_entitlements" IS NOT NULL AND json_valid("placement_decisions"."accepted_entitlements") AND json_type("placement_decisions"."accepted_entitlements") = 'object' AND length("placement_decisions"."accepted_entitlements") <= 262144 AND "placement_decisions"."accepted_defaults" IS NOT NULL AND json_valid("placement_decisions"."accepted_defaults") AND json_type("placement_decisions"."accepted_defaults") = 'array' AND length("placement_decisions"."accepted_defaults") <= 262144
        ELSE "placement_decisions"."accepted_route" IS NULL AND "placement_decisions"."accepted_menu_parent_key" IS NULL AND "placement_decisions"."accepted_label" IS NULL AND "placement_decisions"."accepted_ordering" IS NULL AND "placement_decisions"."accepted_entitlements" IS NULL AND "placement_decisions"."accepted_defaults" IS NULL END),
	CONSTRAINT "placement_decisions_actor" CHECK(length(trim("placement_decisions"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "placement_decisions_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_decisions_public_id_unique` ON `placement_decisions` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `placement_decisions_sequence` ON `placement_decisions` (`placement_request_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `placement_decisions_placement` ON `placement_decisions` (`placement_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `placement_request_environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`placement_request_id` integer NOT NULL,
	`environment` text NOT NULL,
	FOREIGN KEY (`placement_request_id`) REFERENCES `placement_requests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "placement_request_environments_environment" CHECK(length("placement_request_environments"."environment") BETWEEN 1 AND 32 AND "placement_request_environments"."environment" GLOB '[a-z]*' AND "placement_request_environments"."environment" NOT GLOB '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_request_environments_environment` ON `placement_request_environments` (`placement_request_id`,`environment`);--> statement-breakpoint
CREATE TABLE `placement_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`placement_id` integer NOT NULL,
	`application_revision_id` integer NOT NULL,
	`menu_parent_key` text,
	`route` text NOT NULL,
	`label` text NOT NULL,
	`ordering` integer NOT NULL,
	`entitlements` text NOT NULL,
	`entitlements_digest` text NOT NULL,
	`default_requested` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`placement_id`) REFERENCES `application_placements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "placement_requests_menu_parent" CHECK("placement_requests"."menu_parent_key" IS NULL OR length("placement_requests"."menu_parent_key") BETWEEN 1 AND 64 AND "placement_requests"."menu_parent_key" GLOB '[a-z]*' AND "placement_requests"."menu_parent_key" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "placement_requests_route" CHECK(length("placement_requests"."route") BETWEEN 1 AND 200 AND "placement_requests"."route" GLOB '/*' AND instr("placement_requests"."route", '//') = 0 AND ("placement_requests"."route" = '/' OR "placement_requests"."route" NOT GLOB '*/') AND "placement_requests"."route" NOT GLOB '*[?#]*' AND "placement_requests"."route" NOT GLOB '*[^!-~]*'),
	CONSTRAINT "placement_requests_label" CHECK(length(trim("placement_requests"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "placement_requests_ordering" CHECK("placement_requests"."ordering" BETWEEN 0 AND 100000),
	CONSTRAINT "placement_requests_entitlements" CHECK(json_valid("placement_requests"."entitlements") AND json_type("placement_requests"."entitlements") = 'object' AND length("placement_requests"."entitlements") <= 262144),
	CONSTRAINT "placement_requests_entitlements_digest" CHECK(length("placement_requests"."entitlements_digest") = 64 AND "placement_requests"."entitlements_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "placement_requests_default" CHECK("placement_requests"."default_requested" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_requests_revision` ON `placement_requests` (`placement_id`,`application_revision_id`);--> statement-breakpoint
CREATE INDEX `placement_requests_application_revision` ON `placement_requests` (`application_revision_id`);--> statement-breakpoint
CREATE TABLE `placement_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`placement_id` integer NOT NULL,
	`decision_id` integer NOT NULL,
	`portal_id` integer NOT NULL,
	`application_id` integer NOT NULL,
	`environment` text NOT NULL,
	`route` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`activated_at` integer NOT NULL,
	`deactivated_at` integer,
	FOREIGN KEY (`placement_id`) REFERENCES `application_placements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decision_id`) REFERENCES `placement_decisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "placement_routes_environment" CHECK(length("placement_routes"."environment") BETWEEN 1 AND 32 AND "placement_routes"."environment" GLOB '[a-z]*' AND "placement_routes"."environment" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "placement_routes_route" CHECK(length("placement_routes"."route") BETWEEN 1 AND 200 AND "placement_routes"."route" GLOB '/*' AND instr("placement_routes"."route", '//') = 0 AND ("placement_routes"."route" = '/' OR "placement_routes"."route" NOT GLOB '*/') AND "placement_routes"."route" NOT GLOB '*[?#]*' AND "placement_routes"."route" NOT GLOB '*[^!-~]*'),
	CONSTRAINT "placement_routes_active" CHECK("placement_routes"."active" IN (0, 1) AND ("placement_routes"."active" = 1) = ("placement_routes"."deactivated_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_routes_active_route` ON `placement_routes` (`portal_id`,`environment`,`route`) WHERE "placement_routes"."active" = 1;--> statement-breakpoint
CREATE INDEX `placement_routes_placement` ON `placement_routes` (`placement_id`,`active`);--> statement-breakpoint
CREATE TABLE `portal_default_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portal_id` integer NOT NULL,
	`environment` text NOT NULL,
	`sequence` integer NOT NULL,
	`placement_id` integer,
	`decision_id` integer,
	`actor` text NOT NULL,
	`attribution` text NOT NULL,
	`assigned_at` integer NOT NULL,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`placement_id`) REFERENCES `application_placements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decision_id`) REFERENCES `placement_decisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_default_routes_environment" CHECK(length("portal_default_routes"."environment") BETWEEN 1 AND 32 AND "portal_default_routes"."environment" GLOB '[a-z]*' AND "portal_default_routes"."environment" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "portal_default_routes_sequence" CHECK("portal_default_routes"."sequence" >= 0),
	CONSTRAINT "portal_default_routes_actor" CHECK(length(trim("portal_default_routes"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "portal_default_routes_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_default_routes_sequence` ON `portal_default_routes` (`portal_id`,`environment`,`sequence`);--> statement-breakpoint
CREATE TABLE `portal_environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portal_revision_id` integer NOT NULL,
	`environment` text NOT NULL,
	`runtime` text NOT NULL,
	`enabled` integer NOT NULL,
	`entitlements` text NOT NULL,
	`entitlements_digest` text NOT NULL,
	`entitlements_inherited_from` text,
	FOREIGN KEY (`portal_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_environments_environment" CHECK(length("portal_environments"."environment") BETWEEN 1 AND 32 AND "portal_environments"."environment" GLOB '[a-z]*' AND "portal_environments"."environment" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "portal_environments_runtime" CHECK(length("portal_environments"."runtime") BETWEEN 1 AND 64 AND "portal_environments"."runtime" NOT GLOB '*[^A-Za-z0-9._@/-]*'),
	CONSTRAINT "portal_environments_enabled" CHECK("portal_environments"."enabled" IN (0, 1)),
	CONSTRAINT "portal_environments_entitlements" CHECK(json_valid("portal_environments"."entitlements") AND json_type("portal_environments"."entitlements") = 'object' AND length("portal_environments"."entitlements") <= 262144),
	CONSTRAINT "portal_environments_entitlements_digest" CHECK(length("portal_environments"."entitlements_digest") = 64 AND "portal_environments"."entitlements_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "portal_environments_inherited" CHECK("portal_environments"."entitlements_inherited_from" IS NULL OR (length("portal_environments"."entitlements_inherited_from") BETWEEN 1 AND 32 AND "portal_environments"."entitlements_inherited_from" GLOB '[a-z]*' AND "portal_environments"."entitlements_inherited_from" NOT GLOB '*[^a-z0-9-]*' AND "portal_environments"."entitlements_inherited_from" <> "portal_environments"."environment"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_environments_environment` ON `portal_environments` (`portal_revision_id`,`environment`);--> statement-breakpoint
CREATE TABLE `portal_menu_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portal_revision_id` integer NOT NULL,
	`key` text NOT NULL,
	`parent_key` text,
	`label` text NOT NULL,
	`ordering` integer NOT NULL,
	FOREIGN KEY (`portal_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portal_revision_id`,`parent_key`) REFERENCES `portal_menu_groups`(`portal_revision_id`,`key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_menu_groups_key" CHECK(length("portal_menu_groups"."key") BETWEEN 1 AND 64 AND "portal_menu_groups"."key" GLOB '[a-z]*' AND "portal_menu_groups"."key" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "portal_menu_groups_parent" CHECK("portal_menu_groups"."parent_key" IS NULL OR "portal_menu_groups"."parent_key" <> "portal_menu_groups"."key"),
	CONSTRAINT "portal_menu_groups_label" CHECK(length(trim("portal_menu_groups"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "portal_menu_groups_ordering" CHECK("portal_menu_groups"."ordering" BETWEEN 0 AND 100000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_menu_groups_key` ON `portal_menu_groups` (`portal_revision_id`,`key`);--> statement-breakpoint
CREATE TABLE `portal_revisions` (
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
	`portal_id` integer NOT NULL,
	`based_on_revision_id` integer,
	`owner_team` text,
	`seal_id` text,
	`runtimes` text,
	`contract` text,
	`contract_digest` text,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_revisions_number" CHECK("portal_revisions"."number" >= 1),
	CONSTRAINT "portal_revisions_state" CHECK(state IN ('draft', 'submitted')),
	CONSTRAINT "portal_revisions_document" CHECK(json_valid("portal_revisions"."document") AND json_type("portal_revisions"."document") = 'object' AND length("portal_revisions"."document") <= 262144),
	CONSTRAINT "portal_revisions_created_by" CHECK(length(trim("portal_revisions"."created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "portal_revisions_submission" CHECK(CASE "portal_revisions"."state"
      WHEN 'submitted' THEN "portal_revisions"."digest" IS NOT NULL AND length("portal_revisions"."digest") = 64 AND "portal_revisions"."digest" NOT GLOB '*[^0-9a-f]*' AND "portal_revisions"."submitted_at" IS NOT NULL AND "portal_revisions"."submitted_by" IS NOT NULL AND length(trim("portal_revisions"."submitted_by")) BETWEEN 1 AND 200
      ELSE "portal_revisions"."digest" IS NULL AND "portal_revisions"."submitted_at" IS NULL AND "portal_revisions"."submitted_by" IS NULL END),
	CONSTRAINT "portal_revisions_seal_id" CHECK("portal_revisions"."seal_id" IS NULL OR (length("portal_revisions"."seal_id") BETWEEN 1 AND 64 AND "portal_revisions"."seal_id" = trim("portal_revisions"."seal_id"))),
	CONSTRAINT "portal_revisions_owner_team" CHECK("portal_revisions"."owner_team" IS NULL OR length(trim("portal_revisions"."owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "portal_revisions_frozen" CHECK(CASE "portal_revisions"."state" WHEN 'submitted' THEN "portal_revisions"."owner_team" IS NOT NULL AND "portal_revisions"."runtimes" IS NOT NULL AND json_valid("portal_revisions"."runtimes") AND json_type("portal_revisions"."runtimes") = 'array'
        AND "portal_revisions"."contract" IS NOT NULL AND json_valid("portal_revisions"."contract") AND "portal_revisions"."contract_digest" IS NOT NULL AND length("portal_revisions"."contract_digest") = 64 AND "portal_revisions"."contract_digest" NOT GLOB '*[^0-9a-f]*'
        ELSE "portal_revisions"."runtimes" IS NULL AND "portal_revisions"."contract" IS NULL AND "portal_revisions"."contract_digest" IS NULL END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_revisions_number` ON `portal_revisions` (`portal_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_revisions_one_draft` ON `portal_revisions` (`portal_id`) WHERE "portal_revisions"."state" = 'draft';--> statement-breakpoint
CREATE TABLE `rendering_inference_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_revision_id` integer NOT NULL,
	`rendering_mode` text NOT NULL,
	`configuration` text NOT NULL,
	`source` text NOT NULL,
	`evidence_reference` text NOT NULL,
	`observation_id` integer,
	`observed_at` integer NOT NULL,
	`chosen` integer NOT NULL,
	FOREIGN KEY (`application_revision_id`) REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`observation_id`) REFERENCES `external_observations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rendering_inference_candidates_rendering_mode" CHECK(rendering_mode IN ('iframe', 'esm', 'module_federation_2')),
	CONSTRAINT "rendering_inference_candidates_source" CHECK(source IN ('mfe_contract', 'studio', 'cdaas')),
	CONSTRAINT "rendering_inference_candidates_configuration" CHECK(json_valid("rendering_inference_candidates"."configuration") AND json_type("rendering_inference_candidates"."configuration") = 'object' AND length("rendering_inference_candidates"."configuration") <= 262144),
	CONSTRAINT "rendering_inference_candidates_evidence" CHECK(length(trim("rendering_inference_candidates"."evidence_reference")) BETWEEN 1 AND 500),
	CONSTRAINT "rendering_inference_candidates_chosen" CHECK("rendering_inference_candidates"."chosen" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `rendering_inference_candidates_revision` ON `rendering_inference_candidates` (`application_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rendering_inference_candidates_chosen` ON `rendering_inference_candidates` (`application_revision_id`) WHERE "rendering_inference_candidates"."chosen" = 1;--> statement-breakpoint
-- Portals and applications gain their onboarding columns in place. A table
-- rebuild would delete and re-insert rows that assertions reference, so the
-- columns are added with column-level constraints instead. Every existing
-- row becomes a Draft onboarding identity with no revision.
ALTER TABLE `applications` ADD COLUMN `owner_team` text CONSTRAINT "applications_owner_team" CHECK(`owner_team` IS NULL OR length(trim(`owner_team`)) BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `lifecycle` text DEFAULT 'draft' NOT NULL CONSTRAINT "applications_lifecycle" CHECK(`lifecycle` IN ('draft', 'ready', 'active', 'retired'));--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `active_revision_id` integer REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `draft_revision_id` integer REFERENCES `application_revisions`(`id`) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `applications` ADD COLUMN `lock_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `applications_name` ON `applications` (`name`);--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `seal_id` text CONSTRAINT "portals_seal_id" CHECK(`seal_id` IS NULL OR (length(`seal_id`) BETWEEN 1 AND 64 AND `seal_id` = trim(`seal_id`)));--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `owner_team` text CONSTRAINT "portals_owner_team" CHECK(`owner_team` IS NULL OR length(trim(`owner_team`)) BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `lifecycle` text DEFAULT 'draft' NOT NULL CONSTRAINT "portals_lifecycle" CHECK(`lifecycle` IN ('draft', 'ready', 'active', 'retired'));--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `active_revision_id` integer REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `draft_revision_id` integer REFERENCES `portal_revisions`(`id`) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `lock_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `portals_seal_id` ON `portals` (`seal_id`);