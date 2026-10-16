-- Portal platform, slug, and description (add-portal-switcher design decision 5).
-- The columns are added in place rather than by rebuilding portals, which
-- would drop its identity, retirement, and revision-pointer triggers. They
-- stay nullable: a Portal named only in an ownership claim, or onboarded
-- before this migration, has none. migrateDatabase backfills slugs derived
-- from onboarded Portals' names afterwards, because SQLite can't fold accents.
ALTER TABLE `portals` ADD COLUMN `platform` text CONSTRAINT "portals_platform" CHECK(`platform` IS NULL OR `platform` IN ('web', 'mobile', 'desktop'));--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `slug` text CONSTRAINT "portals_slug" CHECK(`slug` IS NULL OR (length(`slug`) BETWEEN 1 AND 63 AND `slug` NOT GLOB '*[^a-z]*'));--> statement-breakpoint
ALTER TABLE `portals` ADD COLUMN `description` text CONSTRAINT "portals_description" CHECK(`description` IS NULL OR length(trim(`description`)) BETWEEN 1 AND 500);--> statement-breakpoint
CREATE UNIQUE INDEX `portals_slug` ON `portals` (`slug`) WHERE "portals"."slug" IS NOT NULL;--> statement-breakpoint
-- A platform and a slug, once recorded, are fixed.
CREATE TRIGGER portals_platform_and_slug_fixed
BEFORE UPDATE OF platform, slug ON portals
WHEN (OLD.platform IS NOT NULL AND NEW.platform IS NOT OLD.platform) OR (OLD.slug IS NOT NULL AND NEW.slug IS NOT OLD.slug)
BEGIN
	SELECT RAISE(ABORT, 'portals: a Portal keeps its platform and slug once recorded');
END;
