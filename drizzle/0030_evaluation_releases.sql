ALTER TABLE `assessments` ADD `evaluation_releases` text;--> statement-breakpoint
-- The Releases a Run is to be evaluated against are fixed when it starts.
CREATE TRIGGER assessments_evaluation_releases_fixed
BEFORE UPDATE OF evaluation_releases ON assessments
WHEN NEW.evaluation_releases IS NOT OLD.evaluation_releases
BEGIN
  SELECT RAISE(ABORT, 'assessments: the Releases a Run is evaluated against are fixed when it starts');
END;
