-- Profiles and Relationship Maps are written once by the assessment pipeline
-- and never change.

-- A Profile describes its own target's pinned snapshot, written while that
-- target is being analyzed.
CREATE TRIGGER repository_profiles_match_snapshot
BEFORE INSERT ON repository_profiles
WHEN NEW.assessment_target_id IS NOT (SELECT assessment_target_id FROM source_snapshots WHERE id = NEW.source_snapshot_id)
  OR NEW.assessment_id IS NOT (SELECT assessment_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'analyzing'
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: a Profile is written for its analyzing target and pinned snapshot');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_immutable
BEFORE UPDATE ON repository_profiles
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: Profiles are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER repository_profiles_never_deleted
BEFORE DELETE ON repository_profiles
BEGIN
  SELECT RAISE(ABORT, 'repository_profiles: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- The map is written once, by the finalizer.
CREATE TRIGGER relationship_maps_written_by_finalizer
BEFORE INSERT ON relationship_maps
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) IS NOT 'finalizing'
BEGIN
  SELECT RAISE(ABORT, 'relationship_maps: the map is written while the assessment is finalizing');
END;
--> statement-breakpoint
CREATE TRIGGER relationship_maps_immutable
BEFORE UPDATE ON relationship_maps
BEGIN
  SELECT RAISE(ABORT, 'relationship_maps: Relationship Maps are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER relationship_maps_never_deleted
BEFORE DELETE ON relationship_maps
BEGIN
  SELECT RAISE(ABORT, 'relationship_maps: results are retained and cannot be deleted');
END;
