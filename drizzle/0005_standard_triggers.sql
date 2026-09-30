-- Published Releases are immutable and retained. Revisions start a new draft.
CREATE TRIGGER standard_releases_immutable
BEFORE UPDATE ON standard_releases
BEGIN
  SELECT RAISE(ABORT, 'standard_releases: published Releases are immutable; revise the Standard in a new draft');
END;
--> statement-breakpoint
CREATE TRIGGER standard_releases_never_deleted
BEFORE DELETE ON standard_releases
BEGIN
  SELECT RAISE(ABORT, 'standard_releases: published Releases are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Release selections are added or removed, never repointed.
CREATE TRIGGER initiative_standard_releases_immutable
BEFORE UPDATE ON initiative_standard_releases
BEGIN
  SELECT RAISE(ABORT, 'initiative_standard_releases: selections cannot be changed in place');
END;
--> statement-breakpoint
CREATE TRIGGER standards_identity_immutable
BEFORE UPDATE OF public_id, created_at ON standards
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'standards: public identity cannot change');
END;
