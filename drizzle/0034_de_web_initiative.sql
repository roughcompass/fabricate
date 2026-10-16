-- The DE Web initiative (make-applications-first-class, design decision 6):
-- DE FabLab owns it, and each of its Runs assesses one Application's
-- repository, which the launch names. The column is added in place rather
-- than by rebuilding initiatives, which would drop its triggers and the ones
-- on other tables that read it.
ALTER TABLE `initiatives` ADD COLUMN `de_web` integer DEFAULT false NOT NULL CONSTRAINT "initiatives_de_web" CHECK(`de_web` IN (0, 1) AND NOT (`de_web` = 1 AND (`system_owned` = 1 OR `claim_repository_source_id` IS NOT NULL)));--> statement-breakpoint
INSERT INTO initiatives (public_id, name, objective, selection_mode, de_web, created_at, updated_at)
VALUES (
  'ini_dewebrendering00',
  'DE Web',
  'Assesses each Application''s repository when it''s created or re-assessed, to determine how DE Web will render it. DE FabLab owns it, and each Run names its repository.',
  'explicit',
  1,
  cast(unixepoch('subsec') * 1000 as integer),
  cast(unixepoch('subsec') * 1000 as integer)
);--> statement-breakpoint
CREATE TRIGGER initiatives_de_web_insert
BEFORE INSERT ON initiatives
WHEN NEW.de_web = 1
BEGIN
	SELECT RAISE(ABORT, 'initiatives: only DE FabLab creates the DE Web initiative');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_de_web_kept
BEFORE UPDATE ON initiatives
WHEN NEW.de_web IS NOT OLD.de_web
  OR (OLD.de_web = 1 AND (NEW.name IS NOT OLD.name OR NEW.objective IS NOT OLD.objective OR NEW.selection_mode IS NOT OLD.selection_mode))
BEGIN
	SELECT RAISE(ABORT, 'initiatives: the DE Web initiative keeps its name, objective, and scope');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_de_web_never_deleted
BEFORE DELETE ON initiatives
WHEN OLD.de_web = 1
BEGIN
	SELECT RAISE(ABORT, 'initiatives: the DE Web initiative is retained');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_not_de_web
BEFORE INSERT ON initiative_targets
WHEN (SELECT de_web FROM initiatives WHERE id = NEW.initiative_id) = 1
BEGIN
	SELECT RAISE(ABORT, 'initiative_targets: each DE Web Run names its own repository');
END;
