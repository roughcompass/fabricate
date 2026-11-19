CREATE TABLE `catalog_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`entry_id` text NOT NULL,
	`version` text NOT NULL,
	`format_version` integer NOT NULL,
	`digest` text NOT NULL,
	`document` text NOT NULL,
	`built_at` integer NOT NULL,
	`sources` text NOT NULL,
	`packages` text NOT NULL,
	`build_job_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`build_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "catalog_entries_kind" CHECK(kind IN ('design_system', 'runtime_api', 'composition_contract')),
	CONSTRAINT "catalog_entries_entry_id" CHECK(length("catalog_entries"."entry_id") BETWEEN 1 AND 64 AND "catalog_entries"."entry_id" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "catalog_entries_version" CHECK(length("catalog_entries"."version") BETWEEN 1 AND 256),
	CONSTRAINT "catalog_entries_format_version" CHECK("catalog_entries"."format_version" > 0),
	CONSTRAINT "catalog_entries_digest" CHECK(length("catalog_entries"."digest") = 64 AND "catalog_entries"."digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "catalog_entries_document" CHECK(json_valid("catalog_entries"."document") AND json_type("catalog_entries"."document") = 'object'),
	CONSTRAINT "catalog_entries_sources" CHECK(json_valid("catalog_entries"."sources") AND json_type("catalog_entries"."sources") = 'array'),
	CONSTRAINT "catalog_entries_packages" CHECK(json_valid("catalog_entries"."packages") AND json_type("catalog_entries"."packages") = 'array' AND json_array_length("catalog_entries"."packages") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_entries_digest_unique` ON `catalog_entries` (`digest`);--> statement-breakpoint
CREATE INDEX `catalog_entries_thing` ON `catalog_entries` (`kind`,`entry_id`,`version`);--> statement-breakpoint
CREATE INDEX `catalog_entries_build_job` ON `catalog_entries` (`build_job_id`);--> statement-breakpoint
-- A stored entry never changes: a rebuild that changes its content is a new entry with a new digest.
CREATE TRIGGER catalog_entries_immutable
BEFORE UPDATE ON catalog_entries
BEGIN
  SELECT RAISE(ABORT, 'catalog_entries: Reference Catalog entries are immutable');
END;
--> statement-breakpoint
-- Every entry a Profile names stays retrievable.
CREATE TRIGGER catalog_entries_never_deleted
BEFORE DELETE ON catalog_entries
BEGIN
  SELECT RAISE(ABORT, 'catalog_entries: Reference Catalog entries are retained and cannot be deleted');
END;
