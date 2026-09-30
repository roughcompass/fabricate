-- Catalog and initiative invariants that the data-access layer also enforces.
-- Messages start with the table name so callers can report which rule fired.

-- Explicit selections exist only on explicit initiatives.
CREATE TRIGGER initiative_targets_require_explicit_mode
BEFORE INSERT ON initiative_targets
WHEN (SELECT selection_mode FROM initiatives WHERE id = NEW.initiative_id) <> 'explicit'
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: only explicit initiatives select sources');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_all_enabled_has_no_targets
BEFORE UPDATE OF selection_mode ON initiatives
WHEN NEW.selection_mode = 'all_enabled' AND EXISTS (SELECT 1 FROM initiative_targets WHERE initiative_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'initiatives: remove explicit selections before targeting all enabled sources');
END;
--> statement-breakpoint
-- Selections are added or removed, never repointed.
CREATE TRIGGER initiative_targets_immutable
BEFORE UPDATE ON initiative_targets
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: selections cannot be changed in place');
END;
--> statement-breakpoint
-- Public identities never change.
CREATE TRIGGER repository_sources_identity_immutable
BEFORE UPDATE OF public_id, created_at ON repository_sources
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'repository_sources: public identity cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_identity_immutable
BEFORE UPDATE OF public_id, created_at ON initiatives
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'initiatives: public identity cannot change');
END;
--> statement-breakpoint
-- Sources are never deleted; disabling one preserves history.
CREATE TRIGGER repository_sources_never_deleted
BEFORE DELETE ON repository_sources
BEGIN
  SELECT RAISE(ABORT, 'repository_sources: sources are disabled, never deleted');
END;
