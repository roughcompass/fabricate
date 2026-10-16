-- Applications are first class (make-applications-first-class design
-- decision 11). Portals and Applications are edited in place: the revision,
-- environment, placement, validation, reconciliation, launch-target,
-- inference, and MFE tables go, with their triggers. Portals become a
-- Prototype or in Production, and their menus are flattened into
-- portal_menu_items. Nothing of the dropped history is kept; this is a POC.
-- The demo deployments Import from BitBucket made go in 0033, a demo
-- migration, so the product schema still builds without the demo tables.
--
-- Menus are staged here and built by migrateDatabase afterwards
-- (backfills.ts), which applies the PROD > UAT > TEST > DEV precedence to
-- routes and the default, and logs every route it has to skip.

-- Triggers on the tables rebuilt below; two read revision tables that are
-- dropped, and a rename refuses to run while they do. The ones that still
-- apply come back after the rebuilds.
DROP TRIGGER portals_revision_pointers;--> statement-breakpoint
DROP TRIGGER portals_retired_stays_retired;--> statement-breakpoint
DROP TRIGGER applications_revision_pointers;--> statement-breakpoint
DROP TRIGGER applications_retired_stays_retired;--> statement-breakpoint
CREATE TABLE `application_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`assessment_id` integer,
	`error` text,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_assessments_outcome" CHECK(("application_assessments"."assessment_id" IS NULL) = ("application_assessments"."error" IS NOT NULL) AND ("application_assessments"."error" IS NULL OR length("application_assessments"."error") BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE INDEX `application_assessments_application` ON `application_assessments` (`application_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_assessments_assessment` ON `application_assessments` (`application_id`,`assessment_id`) WHERE "application_assessments"."assessment_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `portal_menu_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`portal_id` integer NOT NULL,
	`parent_id` integer,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`route` text,
	`application_id` integer,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `portal_menu_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_menu_items_public_id" CHECK("portal_menu_items"."public_id" GLOB 'mnu_*'),
	CONSTRAINT "portal_menu_items_kind" CHECK(kind IN ('group', 'item')),
	CONSTRAINT "portal_menu_items_label" CHECK(length(trim("portal_menu_items"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "portal_menu_items_position" CHECK("portal_menu_items"."position" BETWEEN 0 AND 100000),
	CONSTRAINT "portal_menu_items_is_default" CHECK("portal_menu_items"."is_default" IN (0, 1)),
	CONSTRAINT "portal_menu_items_parent" CHECK("portal_menu_items"."parent_id" IS NULL OR "portal_menu_items"."parent_id" <> "portal_menu_items"."id"),
	CONSTRAINT "portal_menu_items_shape" CHECK(CASE "portal_menu_items"."kind"
        WHEN 'group' THEN "portal_menu_items"."route" IS NULL AND "portal_menu_items"."application_id" IS NULL AND "portal_menu_items"."is_default" = 0
        WHEN 'item' THEN "portal_menu_items"."route" IS NOT NULL AND length("portal_menu_items"."route") BETWEEN 1 AND 200 AND "portal_menu_items"."route" GLOB '/*' AND "portal_menu_items"."route" NOT GLOB '*[^a-z0-9/-]*' AND instr("portal_menu_items"."route", '//') = 0 AND ("portal_menu_items"."route" = '/' OR "portal_menu_items"."route" NOT GLOB '*/') AND "portal_menu_items"."application_id" IS NOT NULL
        ELSE 0 END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_menu_items_public_id_unique` ON `portal_menu_items` (`public_id`);--> statement-breakpoint
CREATE INDEX `portal_menu_items_portal` ON `portal_menu_items` (`portal_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `portal_menu_items_application` ON `portal_menu_items` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_menu_items_route` ON `portal_menu_items` (`portal_id`,`route`) WHERE "portal_menu_items"."route" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `portal_menu_items_one_default` ON `portal_menu_items` (`portal_id`) WHERE "portal_menu_items"."is_default" = 1;--> statement-breakpoint
-- The menu each Portal carries over: the groups of its active revision, or
-- its latest submitted one, or its Draft's document; and every active
-- placement route with the label, parent, and order its approval accepted,
-- and whether it's its environment's current default.
CREATE TABLE `_carried_menu_groups` (`portal_id` integer NOT NULL, `key` text NOT NULL, `parent_key` text, `label` text NOT NULL, `ordering` integer NOT NULL);--> statement-breakpoint
CREATE TABLE `_carried_menu_routes` (`portal_id` integer NOT NULL, `placement_id` integer NOT NULL, `application_id` integer NOT NULL, `environment` text NOT NULL, `route` text NOT NULL, `label` text NOT NULL, `parent_key` text, `ordering` integer NOT NULL, `is_default` integer NOT NULL);--> statement-breakpoint
WITH chosen AS (
  SELECT p.id AS portal_id, coalesce(
    p.active_revision_id,
    (SELECT r.id FROM portal_revisions r WHERE r.portal_id = p.id AND r.state = 'submitted' ORDER BY r.number DESC LIMIT 1),
    p.draft_revision_id) AS revision_id
  FROM portals p
)
INSERT INTO `_carried_menu_groups` (portal_id, key, parent_key, label, ordering)
SELECT c.portal_id, g.key, g.parent_key, g.label, g.ordering
FROM chosen c JOIN portal_revisions r ON r.id = c.revision_id AND r.state = 'submitted'
JOIN portal_menu_groups g ON g.portal_revision_id = r.id
UNION ALL
SELECT c.portal_id, json_extract(m.value, '$.key'), json_extract(m.value, '$.parent'), json_extract(m.value, '$.label'), coalesce(json_extract(m.value, '$.order'), 0)
FROM chosen c JOIN portal_revisions r ON r.id = c.revision_id AND r.state = 'draft'
JOIN json_each(r.document, '$.menu') m
WHERE json_type(m.value, '$.key') = 'text' AND json_type(m.value, '$.label') = 'text';--> statement-breakpoint
INSERT INTO `_carried_menu_routes` (portal_id, placement_id, application_id, environment, route, label, parent_key, ordering, is_default)
SELECT pr.portal_id, pr.placement_id, pr.application_id, pr.environment, pr.route, d.accepted_label, d.accepted_menu_parent_key, d.accepted_ordering,
  coalesce((SELECT dr.placement_id FROM portal_default_routes dr WHERE dr.portal_id = pr.portal_id AND dr.environment = pr.environment ORDER BY dr.sequence DESC LIMIT 1) = pr.placement_id, 0)
FROM placement_routes pr JOIN placement_decisions d ON d.id = pr.decision_id
WHERE pr.active = 1 AND d.decision = 'approve';--> statement-breakpoint
-- The Portals that were onboarded, which the slug backfill derives slugs for
-- once their revisions are gone.
CREATE TABLE `_carried_onboarded_portals` (`portal_id` integer PRIMARY KEY NOT NULL);--> statement-breakpoint
INSERT INTO `_carried_onboarded_portals` (portal_id) SELECT DISTINCT portal_id FROM portal_revisions;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`seal_id` text,
	`name` text,
	`created_at` integer NOT NULL,
	`owner_team` text,
	`slug` text,
	`description` text,
	`starter` text,
	`repository_source_id` integer,
	`portal_id` integer,
	`rendering_mode` text,
	`rendering_evidence` text,
	`rendering_assessment_id` integer,
	`created_by` text,
	`verification` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rendering_assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "applications_public_id" CHECK("__new_applications"."public_id" GLOB 'sea_*' OR "__new_applications"."public_id" GLOB 'wap_*'),
	CONSTRAINT "applications_seal_id" CHECK("__new_applications"."seal_id" IS NULL OR (length("__new_applications"."seal_id") BETWEEN 1 AND 64 AND "__new_applications"."seal_id" = trim("__new_applications"."seal_id"))),
	CONSTRAINT "applications_name" CHECK("__new_applications"."name" IS NULL OR length(trim("__new_applications"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "applications_owner_team" CHECK("__new_applications"."owner_team" IS NULL OR length(trim("__new_applications"."owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "applications_slug" CHECK("__new_applications"."slug" IS NULL OR (length("__new_applications"."slug") BETWEEN 1 AND 63 AND "__new_applications"."slug" GLOB '[a-z]*' AND "__new_applications"."slug" NOT GLOB '*[^a-z0-9-]*' AND "__new_applications"."slug" NOT GLOB '*--*' AND "__new_applications"."slug" NOT GLOB '*-')),
	CONSTRAINT "applications_description" CHECK("__new_applications"."description" IS NULL OR length(trim("__new_applications"."description")) BETWEEN 1 AND 500),
	CONSTRAINT "applications_starter" CHECK("__new_applications"."starter" IS NULL OR (length("__new_applications"."starter") BETWEEN 1 AND 100 AND "__new_applications"."starter" NOT GLOB '*[^a-z0-9-]*')),
	CONSTRAINT "applications_registered" CHECK("__new_applications"."repository_source_id" IS NULL OR ("__new_applications"."slug" IS NOT NULL AND "__new_applications"."portal_id" IS NOT NULL AND "__new_applications"."name" IS NOT NULL AND "__new_applications"."seal_id" IS NOT NULL AND "__new_applications"."description" IS NOT NULL)),
	CONSTRAINT "applications_rendering_mode" CHECK(rendering_mode IS NULL OR rendering_mode IN ('esm', 'module_federation_2', 'iframe', 'undetermined')),
	CONSTRAINT "applications_rendering" CHECK(("__new_applications"."rendering_mode" IS NULL) = ("__new_applications"."rendering_evidence" IS NULL) AND ("__new_applications"."rendering_mode" IS NULL) = ("__new_applications"."rendering_assessment_id" IS NULL)
        AND ("__new_applications"."rendering_evidence" IS NULL OR (json_valid("__new_applications"."rendering_evidence") AND json_type("__new_applications"."rendering_evidence") = 'object' AND length("__new_applications"."rendering_evidence") <= 65536))),
	CONSTRAINT "applications_created_by" CHECK(("__new_applications"."created_by" IS NULL) = ("__new_applications"."verification" IS NULL) AND ("__new_applications"."created_by" IS NULL OR length(trim("__new_applications"."created_by")) BETWEEN 1 AND 200)),
	CONSTRAINT "applications_verification" CHECK(verification IS NULL OR verification IN ('unverified', 'verified', 'not_required'))
);
--> statement-breakpoint
-- An Application belongs to the Portal of its earliest approved placement,
-- or its earliest placement when none was approved.
INSERT INTO `__new_applications`("id", "public_id", "seal_id", "name", "created_at", "owner_team", "portal_id", "updated_at", "lock_version")
SELECT a."id", a."public_id", a."seal_id", a."name", a."created_at", a."owner_team",
  (SELECT pl.portal_id FROM application_placements pl WHERE pl.application_id = a.id
    ORDER BY EXISTS (SELECT 1 FROM placement_decisions d WHERE d.placement_id = pl.id AND d.decision = 'approve') DESC, pl.created_at, pl.id LIMIT 1),
  a."created_at", a."lock_version"
FROM `applications` a;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_public_id_unique` ON `applications` (`public_id`);--> statement-breakpoint
CREATE INDEX `applications_seal_id` ON `applications` (`seal_id`);--> statement-breakpoint
CREATE INDEX `applications_name` ON `applications` (`name`);--> statement-breakpoint
CREATE INDEX `applications_portal` ON `applications` (`portal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_slug` ON `applications` (`slug`) WHERE "applications"."slug" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_repository` ON `applications` (`repository_source_id`) WHERE "applications"."repository_source_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_portals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`label` text NOT NULL,
	`label_key` text NOT NULL,
	`concept_key` text,
	`created_at` integer NOT NULL,
	`seal_id` text,
	`owner_team` text,
	`platform` text,
	`slug` text,
	`description` text,
	`lifecycle` text DEFAULT 'prototype' NOT NULL,
	`lock_version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "portals_public_id" CHECK("__new_portals"."public_id" GLOB 'ptl_*'),
	CONSTRAINT "portals_label" CHECK(length(trim("__new_portals"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "portals_concept" CHECK("__new_portals"."concept_key" IS NULL OR "__new_portals"."concept_key" GLOB 'portal/*'),
	CONSTRAINT "portals_seal_id" CHECK("__new_portals"."seal_id" IS NULL OR (length("__new_portals"."seal_id") BETWEEN 1 AND 64 AND "__new_portals"."seal_id" = trim("__new_portals"."seal_id"))),
	CONSTRAINT "portals_owner_team" CHECK("__new_portals"."owner_team" IS NULL OR length(trim("__new_portals"."owner_team")) BETWEEN 1 AND 200),
	CONSTRAINT "portals_platform" CHECK(platform IS NULL OR platform IN ('web', 'mobile', 'desktop')),
	CONSTRAINT "portals_slug" CHECK("__new_portals"."slug" IS NULL OR (length("__new_portals"."slug") BETWEEN 1 AND 63 AND "__new_portals"."slug" NOT GLOB '*[^a-z]*')),
	CONSTRAINT "portals_description" CHECK("__new_portals"."description" IS NULL OR length(trim("__new_portals"."description")) BETWEEN 1 AND 500),
	CONSTRAINT "portals_lifecycle" CHECK(lifecycle IN ('prototype', 'production'))
);
--> statement-breakpoint
-- An Active Portal is in Production; Draft, Ready, and Retired Portals are Prototypes.
INSERT INTO `__new_portals`("id", "public_id", "label", "label_key", "concept_key", "created_at", "seal_id", "owner_team", "platform", "slug", "description", "lifecycle", "lock_version")
SELECT "id", "public_id", "label", "label_key", "concept_key", "created_at", "seal_id", "owner_team", "platform", "slug", "description",
  CASE "lifecycle" WHEN 'active' THEN 'production' ELSE 'prototype' END, "lock_version"
FROM `portals`;--> statement-breakpoint
DROP TABLE `portals`;--> statement-breakpoint
ALTER TABLE `__new_portals` RENAME TO `portals`;--> statement-breakpoint
CREATE UNIQUE INDEX `portals_public_id_unique` ON `portals` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portals_label_key_unique` ON `portals` (`label_key`);--> statement-breakpoint
CREATE INDEX `portals_seal_id` ON `portals` (`seal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portals_slug` ON `portals` (`slug`) WHERE "portals"."slug" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_onboarding_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`portal_id` integer,
	`application_id` integer,
	`event` text NOT NULL,
	`from_lifecycle` text,
	`to_lifecycle` text,
	`detail` text,
	`actor` text NOT NULL,
	`attribution` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`portal_id`) REFERENCES `portals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "onboarding_events_subject" CHECK(CASE "__new_onboarding_events"."subject"
      WHEN 'portal' THEN "__new_onboarding_events"."portal_id" IS NOT NULL AND "__new_onboarding_events"."application_id" IS NULL
      WHEN 'application' THEN "__new_onboarding_events"."application_id" IS NOT NULL AND "__new_onboarding_events"."portal_id" IS NULL
      ELSE 0 END),
	CONSTRAINT "onboarding_events_event" CHECK(event IN ('created', 'details_changed', 'menu_changed', 'default_changed', 'promoted', 'returned_to_prototype')),
	CONSTRAINT "onboarding_events_lifecycle" CHECK((from_lifecycle IS NULL OR from_lifecycle IN ('prototype', 'production')) AND (to_lifecycle IS NULL OR to_lifecycle IN ('prototype', 'production'))),
	CONSTRAINT "onboarding_events_detail" CHECK("__new_onboarding_events"."detail" IS NULL OR length(trim("__new_onboarding_events"."detail")) BETWEEN 1 AND 500),
	CONSTRAINT "onboarding_events_actor" CHECK(length(trim("__new_onboarding_events"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "onboarding_events_attribution" CHECK(attribution IN ('unverified', 'system'))
);
--> statement-breakpoint
-- History keeps what still means something: each record's creation, its
-- detail edits, and a Portal's activation as its promotion to Production.
-- Revision, readiness, and MFE events are dropped.
INSERT INTO `__new_onboarding_events`("id", "subject", "portal_id", "application_id", "event", "from_lifecycle", "to_lifecycle", "detail", "actor", "attribution", "occurred_at")
SELECT "id", "subject", "portal_id", "application_id",
  CASE "event" WHEN 'metadata_changed' THEN 'details_changed' WHEN 'activated' THEN 'promoted' ELSE "event" END,
  CASE WHEN "event" = 'activated' THEN 'prototype' END,
  CASE WHEN "event" = 'activated' THEN 'production' WHEN "subject" = 'portal' AND "event" = 'created' THEN 'prototype' END,
  NULL, "actor", "attribution", "occurred_at"
FROM `onboarding_events`
WHERE "subject" IN ('portal', 'application') AND ("event" IN ('created', 'metadata_changed') OR ("event" = 'activated' AND "subject" = 'portal'));--> statement-breakpoint
DROP TABLE `onboarding_events`;--> statement-breakpoint
ALTER TABLE `__new_onboarding_events` RENAME TO `onboarding_events`;--> statement-breakpoint
CREATE INDEX `onboarding_events_portal` ON `onboarding_events` (`portal_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `onboarding_events_application` ON `onboarding_events` (`application_id`,`occurred_at`);--> statement-breakpoint
DROP TABLE `application_components`;--> statement-breakpoint
DROP TABLE `application_environments`;--> statement-breakpoint
DROP TABLE `application_launch_targets`;--> statement-breakpoint
DROP TABLE `application_placements`;--> statement-breakpoint
DROP TABLE `application_revisions`;--> statement-breakpoint
DROP TABLE `environment_catalog_reads`;--> statement-breakpoint
DROP TABLE `external_observations`;--> statement-breakpoint
DROP TABLE `external_reads`;--> statement-breakpoint
DROP TABLE `external_references`;--> statement-breakpoint
DROP TABLE `microfrontend_revisions`;--> statement-breakpoint
DROP TABLE `microfrontends`;--> statement-breakpoint
DROP TABLE `onboarding_validations`;--> statement-breakpoint
DROP TABLE `placement_decisions`;--> statement-breakpoint
DROP TABLE `placement_request_environments`;--> statement-breakpoint
DROP TABLE `placement_requests`;--> statement-breakpoint
DROP TABLE `placement_routes`;--> statement-breakpoint
DROP TABLE `portal_default_routes`;--> statement-breakpoint
DROP TABLE `portal_environments`;--> statement-breakpoint
DROP TABLE `portal_menu_groups`;--> statement-breakpoint
DROP TABLE `portal_revisions`;--> statement-breakpoint
DROP TABLE `rendering_inference_candidates`;--> statement-breakpoint
-- Studio and CDaaS reconciliation is removed, so its queued reads are too.
DELETE FROM jobs WHERE kind IN ('onboarding.refresh', 'onboarding.refresh-subject');--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TRIGGER portals_identity
BEFORE UPDATE ON portals
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.concept_key IS NOT NULL AND NEW.concept_key IS NOT OLD.concept_key)
BEGIN
  SELECT RAISE(ABORT, 'portals: a portal keeps its identity, and its concept once approved');
END;
--> statement-breakpoint
CREATE TRIGGER portals_never_deleted
BEFORE DELETE ON portals
BEGIN
  SELECT RAISE(ABORT, 'portals: ownership records are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER portals_platform_and_slug_fixed
BEFORE UPDATE OF platform, slug ON portals
WHEN (OLD.platform IS NOT NULL AND NEW.platform IS NOT OLD.platform) OR (OLD.slug IS NOT NULL AND NEW.slug IS NOT OLD.slug)
BEGIN
	SELECT RAISE(ABORT, 'portals: a Portal keeps its platform and slug once recorded');
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
--> statement-breakpoint
-- An Application keeps its slug, Portal, and repository once it has them.
CREATE TRIGGER applications_registration_fixed
BEFORE UPDATE OF slug, portal_id, repository_source_id ON applications
WHEN (OLD.slug IS NOT NULL AND NEW.slug IS NOT OLD.slug)
  OR (OLD.portal_id IS NOT NULL AND NEW.portal_id IS NOT OLD.portal_id)
  OR (OLD.repository_source_id IS NOT NULL AND NEW.repository_source_id IS NOT OLD.repository_source_id)
BEGIN
	SELECT RAISE(ABORT, 'applications: an application keeps its slug, Portal, and repository once recorded');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_events_immutable
BEFORE UPDATE ON onboarding_events
BEGIN
	SELECT RAISE(ABORT, 'onboarding_events: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_events_never_deleted
BEFORE DELETE ON onboarding_events
BEGIN
	SELECT RAISE(ABORT, 'onboarding_events: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A menu item points at an Application of its own Portal, and an entry's
-- parent is a group of the same Portal; an entry stays in its Portal.
CREATE TRIGGER portal_menu_items_application_in_portal
BEFORE INSERT ON portal_menu_items
WHEN NEW.application_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM applications WHERE id = NEW.application_id AND portal_id = NEW.portal_id)
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_items: an item points at an Application of its own Portal');
END;
--> statement-breakpoint
CREATE TRIGGER portal_menu_items_application_in_portal_on_update
BEFORE UPDATE OF application_id ON portal_menu_items
WHEN NEW.application_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM applications WHERE id = NEW.application_id AND portal_id = NEW.portal_id)
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_items: an item points at an Application of its own Portal');
END;
--> statement-breakpoint
CREATE TRIGGER portal_menu_items_parent_group
BEFORE INSERT ON portal_menu_items
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_menu_items WHERE id = NEW.parent_id AND portal_id = NEW.portal_id AND kind = 'group')
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_items: a parent is a group of the same Portal');
END;
--> statement-breakpoint
CREATE TRIGGER portal_menu_items_parent_group_on_update
BEFORE UPDATE OF parent_id ON portal_menu_items
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_menu_items WHERE id = NEW.parent_id AND portal_id = NEW.portal_id AND kind = 'group')
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_items: a parent is a group of the same Portal');
END;
--> statement-breakpoint
CREATE TRIGGER portal_menu_items_portal_fixed
BEFORE UPDATE OF portal_id, kind, public_id ON portal_menu_items
WHEN NEW.portal_id IS NOT OLD.portal_id OR NEW.kind IS NOT OLD.kind OR NEW.public_id IS NOT OLD.public_id
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_items: an entry keeps its Portal, kind, and public ID');
END;
--> statement-breakpoint
CREATE TRIGGER application_assessments_immutable
BEFORE UPDATE ON application_assessments
BEGIN
	SELECT RAISE(ABORT, 'application_assessments: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER application_assessments_never_deleted
BEFORE DELETE ON application_assessments
BEGIN
	SELECT RAISE(ABORT, 'application_assessments: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Every row the rebuilds copied still points at what it pointed at before;
-- a violation fails the migration, and the whole run rolls back.
CREATE TEMP TABLE applications_first_class_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO applications_first_class_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE applications_first_class_foreign_keys;
