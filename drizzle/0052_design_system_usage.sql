CREATE TABLE `design_system_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`design_systems_state` text,
	`ui_elements_state` text,
	`style_values_state` text,
	`recognized` text NOT NULL,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "design_system_profiles_recognized" CHECK(json_valid("design_system_profiles"."recognized") AND json_type("design_system_profiles"."recognized") = 'array'),
	CONSTRAINT "design_system_profiles_document_digest" CHECK(length("design_system_profiles"."document_digest") = 64),
	CONSTRAINT "design_system_profiles_projection_version" CHECK("design_system_profiles"."projection_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_system_profiles_profile_id_unique` ON `design_system_profiles` (`profile_id`);--> statement-breakpoint
CREATE TABLE `design_system_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`design_system` text NOT NULL,
	`entry_digest` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`counterpart` text,
	`app_sites` integer NOT NULL,
	`app_customized` integer NOT NULL,
	`app_unknown` integer NOT NULL,
	`stories_sites` integer NOT NULL,
	`stories_customized` integer NOT NULL,
	`stories_unknown` integer NOT NULL,
	`tests_sites` integer NOT NULL,
	`tests_customized` integer NOT NULL,
	`tests_unknown` integer NOT NULL,
	`props` text,
	`document_digest` text NOT NULL,
	`projection_version` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `repository_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "design_system_usage_kind" CHECK(kind IN ('component', 'element')),
	CONSTRAINT "design_system_usage_counts" CHECK(min("design_system_usage"."app_sites", "design_system_usage"."app_customized", "design_system_usage"."app_unknown", "design_system_usage"."stories_sites", "design_system_usage"."stories_customized", "design_system_usage"."stories_unknown", "design_system_usage"."tests_sites", "design_system_usage"."tests_customized", "design_system_usage"."tests_unknown") >= 0),
	CONSTRAINT "design_system_usage_props" CHECK("design_system_usage"."props" IS NULL OR ("design_system_usage"."kind" = 'component' AND json_valid("design_system_usage"."props") AND json_type("design_system_usage"."props") = 'object')),
	CONSTRAINT "design_system_usage_entry_digest" CHECK("design_system_usage"."entry_digest" IS NULL OR length("design_system_usage"."entry_digest") = 64),
	CONSTRAINT "design_system_usage_document_digest" CHECK(length("design_system_usage"."document_digest") = 64),
	CONSTRAINT "design_system_usage_projection_version" CHECK("design_system_usage"."projection_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `design_system_usage_name` ON `design_system_usage` (`design_system`,`kind`,`name`);--> statement-breakpoint
CREATE INDEX `design_system_usage_profile` ON `design_system_usage` (`profile_id`);--> statement-breakpoint
CREATE TRIGGER design_system_usage_immutable
BEFORE UPDATE ON design_system_usage
BEGIN
  SELECT RAISE(ABORT, 'design_system_usage: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER design_system_profiles_immutable
BEFORE UPDATE ON design_system_profiles
BEGIN
  SELECT RAISE(ABORT, 'design_system_profiles: projection rows are written once');
END;
