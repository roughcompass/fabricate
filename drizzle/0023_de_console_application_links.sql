CREATE TABLE `de_console_conflicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`read_id` integer NOT NULL,
	`console_key` text NOT NULL,
	`seal_id` text,
	`name` text,
	`reason` text NOT NULL,
	`candidates` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`read_id`) REFERENCES `de_console_reads`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "de_console_conflicts_public_id" CHECK("de_console_conflicts"."public_id" GLOB 'dcc_*'),
	CONSTRAINT "de_console_conflicts_reason" CHECK(reason IN ('duplicate_in_export', 'several_applications')),
	CONSTRAINT "de_console_conflicts_candidates" CHECK(json_valid("de_console_conflicts"."candidates") AND json_type("de_console_conflicts"."candidates") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `de_console_conflicts_public_id_unique` ON `de_console_conflicts` (`public_id`);--> statement-breakpoint
CREATE INDEX `de_console_conflicts_key` ON `de_console_conflicts` (`console_key`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `de_console_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`console_key` text NOT NULL,
	`application_id` integer NOT NULL,
	`basis` text NOT NULL,
	`linked_by` text,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "de_console_links_key" CHECK(("de_console_links"."console_key" GLOB 'id:?*' OR "de_console_links"."console_key" GLOB 'seal:?*') AND length("de_console_links"."console_key") <= 140),
	CONSTRAINT "de_console_links_basis" CHECK(basis IN ('created', 'matched', 'resolved', 'migrated')),
	CONSTRAINT "de_console_links_linked_by" CHECK(("de_console_links"."basis" = 'resolved') = ("de_console_links"."linked_by" IS NOT NULL) AND ("de_console_links"."linked_by" IS NULL OR length(trim("de_console_links"."linked_by")) BETWEEN 1 AND 200))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `de_console_links_console_key_unique` ON `de_console_links` (`console_key`);--> statement-breakpoint
CREATE INDEX `de_console_links_application` ON `de_console_links` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `de_console_links_one_console_id` ON `de_console_links` (`application_id`) WHERE "de_console_links"."console_key" GLOB 'id:*';--> statement-breakpoint
-- Each application the DE Console already described keeps that description:
-- before onboarding a SEAL ID named one application, so its legacy key links
-- to that application and to no other that later carries the same SEAL ID.
INSERT INTO `de_console_links` (`console_key`, `application_id`, `basis`, `linked_at`)
SELECT 'seal:' || `applications`.`seal_id`, `applications`.`id`, 'migrated', min(`ownership_assertions`.`recorded_at`)
FROM `applications`
JOIN `ownership_assertions` ON `ownership_assertions`.`subject_application_id` = `applications`.`id` AND `ownership_assertions`.`source` = 'de_console'
WHERE `applications`.`seal_id` IS NOT NULL
GROUP BY `applications`.`id`;
--> statement-breakpoint
CREATE TRIGGER de_console_links_immutable
BEFORE UPDATE ON de_console_links
BEGIN
	SELECT RAISE(ABORT, 'de_console_links: a link is recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER de_console_links_never_deleted
BEFORE DELETE ON de_console_links
BEGIN
	SELECT RAISE(ABORT, 'de_console_links: links are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER de_console_conflicts_immutable
BEFORE UPDATE ON de_console_conflicts
BEGIN
	SELECT RAISE(ABORT, 'de_console_conflicts: a conflict is recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER de_console_conflicts_never_deleted
BEFORE DELETE ON de_console_conflicts
BEGIN
	SELECT RAISE(ABORT, 'de_console_conflicts: conflicts are retained and cannot be deleted');
END;
