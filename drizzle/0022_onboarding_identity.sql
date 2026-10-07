DROP TRIGGER ownership_assertions_immutable;
--> statement-breakpoint
DROP TRIGGER ownership_assertions_never_deleted;
--> statement-breakpoint
DROP TRIGGER ownership_supersessions_immutable;
--> statement-breakpoint
DROP TRIGGER ownership_supersessions_never_deleted;
--> statement-breakpoint
DROP TRIGGER ownership_supersessions_same_subject;
--> statement-breakpoint
DROP TRIGGER seal_applications_identity;
--> statement-breakpoint
DROP TRIGGER seal_applications_never_deleted;
--> statement-breakpoint
DROP INDEX `ownership_assertions_public_id_unique`;
--> statement-breakpoint
DROP INDEX `ownership_assertions_subject_repository`;
--> statement-breakpoint
DROP INDEX `ownership_assertions_subject_application`;
--> statement-breakpoint
DROP INDEX `ownership_assertions_subject_portal`;
--> statement-breakpoint
DROP INDEX `ownership_assertions_value_application`;
--> statement-breakpoint
DROP INDEX `ownership_assertions_value_repository`;
--> statement-breakpoint
DROP INDEX `ownership_supersessions_superseded`;
--> statement-breakpoint
ALTER TABLE `seal_applications` RENAME TO `__old_applications`;
--> statement-breakpoint
DROP INDEX `seal_applications_public_id_unique`;
--> statement-breakpoint
DROP INDEX `seal_applications_seal_id_unique`;
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`seal_id` text,
	`name` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `applications_public_id` CHECK(`public_id` GLOB 'sea_*' OR `public_id` GLOB 'wap_*'),
	CONSTRAINT `applications_seal_id` CHECK(`seal_id` IS NULL OR (length(`seal_id`) BETWEEN 1 AND 64 AND `seal_id` = trim(`seal_id`))),
	CONSTRAINT `applications_name` CHECK(`name` IS NULL OR length(trim(`name`)) BETWEEN 1 AND 200)
);
--> statement-breakpoint
INSERT INTO `applications` (`id`, `public_id`, `seal_id`, `name`, `created_at`)
SELECT `id`, `public_id`, `seal_id`, `name`, `created_at` FROM `__old_applications`;
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_public_id_unique` ON `applications` (`public_id`);
--> statement-breakpoint
CREATE INDEX `applications_seal_id` ON `applications` (`seal_id`);
--> statement-breakpoint
ALTER TABLE `ownership_supersessions` RENAME TO `__old_ownership_supersessions`;
--> statement-breakpoint
ALTER TABLE `ownership_assertions` RENAME TO `__old_ownership_assertions`;
--> statement-breakpoint
CREATE TABLE `ownership_assertions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`attribute` text NOT NULL,
	`operation` text NOT NULL,
	`subject_repository_source_id` integer,
	`subject_application_id` integer,
	`subject_portal_id` integer,
	`value_application_id` integer,
	`value_team` text,
	`value_line_of_business_id` integer,
	`value_portal_id` integer,
	`value_repository_source_id` integer,
	`provided_by` text NOT NULL,
	`attributed_to` text,
	`source` text NOT NULL,
	`verification` text NOT NULL,
	`verified_at` integer,
	`read_at` integer,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`subject_repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_line_of_business_id`) REFERENCES `lines_of_business`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`value_repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ownership_assertions_public_id` CHECK(`public_id` GLOB 'own_*'),
	CONSTRAINT `ownership_assertions_attribute` CHECK(`attribute` IN ('application', 'team', 'line_of_business', 'portal', 'owner', 'host')),
	CONSTRAINT `ownership_assertions_operation` CHECK(`operation` IN ('set', 'add', 'remove')),
	CONSTRAINT `ownership_assertions_source` CHECK(`source` IN ('person', 'de_console', 'bulk_import')),
	CONSTRAINT `ownership_assertions_verification` CHECK(`verification` IN ('unverified', 'verified', 'not_required')),
	CONSTRAINT `ownership_assertions_shape` CHECK((CASE `attribute`
		WHEN 'application' THEN `subject_repository_source_id` IS NOT NULL AND `subject_application_id` IS NULL AND `subject_portal_id` IS NULL
			AND `operation` = 'set' AND `value_application_id` IS NOT NULL
			AND `value_team` IS NULL AND `value_line_of_business_id` IS NULL AND `value_portal_id` IS NULL AND `value_repository_source_id` IS NULL
		WHEN 'team' THEN `subject_application_id` IS NOT NULL AND `subject_repository_source_id` IS NULL AND `subject_portal_id` IS NULL
			AND `operation` = 'set' AND length(trim(`value_team`)) BETWEEN 1 AND 200
			AND `value_application_id` IS NULL AND `value_line_of_business_id` IS NULL AND `value_portal_id` IS NULL AND `value_repository_source_id` IS NULL
		WHEN 'line_of_business' THEN `subject_application_id` IS NOT NULL AND `subject_repository_source_id` IS NULL AND `subject_portal_id` IS NULL
			AND `operation` = 'set' AND `value_line_of_business_id` IS NOT NULL
			AND `value_application_id` IS NULL AND `value_team` IS NULL AND `value_portal_id` IS NULL AND `value_repository_source_id` IS NULL
		WHEN 'portal' THEN `subject_application_id` IS NOT NULL AND `subject_repository_source_id` IS NULL AND `subject_portal_id` IS NULL
			AND `operation` IN ('add', 'remove') AND `value_portal_id` IS NOT NULL
			AND `value_application_id` IS NULL AND `value_team` IS NULL AND `value_line_of_business_id` IS NULL AND `value_repository_source_id` IS NULL
		WHEN 'owner' THEN `subject_portal_id` IS NOT NULL AND `subject_repository_source_id` IS NULL AND `subject_application_id` IS NULL
			AND `operation` = 'set' AND `value_application_id` IS NOT NULL
			AND `value_team` IS NULL AND `value_line_of_business_id` IS NULL AND `value_portal_id` IS NULL AND `value_repository_source_id` IS NULL
		WHEN 'host' THEN `subject_portal_id` IS NOT NULL AND `subject_repository_source_id` IS NULL AND `subject_application_id` IS NULL
			AND `operation` = 'set' AND `value_repository_source_id` IS NOT NULL
			AND `value_application_id` IS NULL AND `value_team` IS NULL AND `value_line_of_business_id` IS NULL AND `value_portal_id` IS NULL
		ELSE 0 END)),
	CONSTRAINT `ownership_assertions_provided_by` CHECK(length(trim(`provided_by`)) BETWEEN 1 AND 200),
	CONSTRAINT `ownership_assertions_attributed_to` CHECK(`attributed_to` IS NULL OR length(trim(`attributed_to`)) BETWEEN 1 AND 200),
	CONSTRAINT `ownership_assertions_trust` CHECK(CASE `source`
		WHEN 'de_console' THEN `verification` = 'not_required' AND `read_at` IS NOT NULL
		ELSE `verification` IN ('unverified', 'verified') AND `read_at` IS NULL END),
	CONSTRAINT `ownership_assertions_verified_at` CHECK((`verification` = 'verified') = (`verified_at` IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `ownership_assertions` (
	`id`, `public_id`, `attribute`, `operation`, `subject_repository_source_id`, `subject_application_id`, `subject_portal_id`,
	`value_application_id`, `value_team`, `value_line_of_business_id`, `value_portal_id`, `value_repository_source_id`,
	`provided_by`, `attributed_to`, `source`, `verification`, `verified_at`, `read_at`, `recorded_at`
)
SELECT
	`id`, `public_id`, CASE `attribute` WHEN 'seal_id' THEN 'application' ELSE `attribute` END, `operation`,
	`subject_repository_source_id`, `subject_application_id`, `subject_portal_id`, `value_application_id`, `value_team`,
	`value_line_of_business_id`, `value_portal_id`, `value_repository_source_id`, `provided_by`, `attributed_to`, `source`,
	`verification`, `verified_at`, `read_at`, `recorded_at`
FROM `__old_ownership_assertions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ownership_assertions_public_id_unique` ON `ownership_assertions` (`public_id`);
--> statement-breakpoint
CREATE INDEX `ownership_assertions_subject_repository` ON `ownership_assertions` (`subject_repository_source_id`,`attribute`);
--> statement-breakpoint
CREATE INDEX `ownership_assertions_subject_application` ON `ownership_assertions` (`subject_application_id`,`attribute`);
--> statement-breakpoint
CREATE INDEX `ownership_assertions_subject_portal` ON `ownership_assertions` (`subject_portal_id`,`attribute`);
--> statement-breakpoint
CREATE INDEX `ownership_assertions_value_application` ON `ownership_assertions` (`value_application_id`);
--> statement-breakpoint
CREATE INDEX `ownership_assertions_value_repository` ON `ownership_assertions` (`value_repository_source_id`);
--> statement-breakpoint
CREATE TABLE `ownership_supersessions` (
	`assertion_id` integer NOT NULL,
	`superseded_id` integer NOT NULL,
	PRIMARY KEY(`assertion_id`, `superseded_id`),
	FOREIGN KEY (`assertion_id`) REFERENCES `ownership_assertions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`superseded_id`) REFERENCES `ownership_assertions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `ownership_supersessions` (`assertion_id`, `superseded_id`)
SELECT `assertion_id`, `superseded_id` FROM `__old_ownership_supersessions`;
--> statement-breakpoint
CREATE INDEX `ownership_supersessions_superseded` ON `ownership_supersessions` (`superseded_id`);
--> statement-breakpoint
DROP TABLE `__old_ownership_supersessions`;
--> statement-breakpoint
DROP TABLE `__old_ownership_assertions`;
--> statement-breakpoint
DROP TABLE `__old_applications`;
--> statement-breakpoint
CREATE TRIGGER ownership_assertions_immutable
BEFORE UPDATE ON ownership_assertions
BEGIN
	SELECT RAISE(ABORT, 'ownership_assertions: assertions are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER ownership_assertions_never_deleted
BEFORE DELETE ON ownership_assertions
BEGIN
	SELECT RAISE(ABORT, 'ownership_assertions: assertions are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER ownership_supersessions_immutable
BEFORE UPDATE ON ownership_supersessions
BEGIN
	SELECT RAISE(ABORT, 'ownership_supersessions: supersessions are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER ownership_supersessions_never_deleted
BEFORE DELETE ON ownership_supersessions
BEGIN
	SELECT RAISE(ABORT, 'ownership_supersessions: supersessions are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER ownership_supersessions_same_subject
BEFORE INSERT ON ownership_supersessions
WHEN NOT EXISTS (
	SELECT 1
	FROM ownership_assertions AS assertion
	JOIN ownership_assertions AS superseded ON superseded.id = NEW.superseded_id
	WHERE assertion.id = NEW.assertion_id
		AND superseded.id < assertion.id
		AND superseded.attribute = assertion.attribute
		AND superseded.subject_repository_source_id IS assertion.subject_repository_source_id
		AND superseded.subject_application_id IS assertion.subject_application_id
		AND superseded.subject_portal_id IS assertion.subject_portal_id
)
BEGIN
	SELECT RAISE(ABORT, 'ownership_supersessions: an assertion supersedes an earlier one about the same subject and attribute');
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