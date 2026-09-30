-- Assessment scope and snapshot invariants. The data-access layer enforces the
-- same rules; these triggers hold even for direct SQL.

-- The inputs an Assessment records never change.
CREATE TRIGGER assessments_inputs_immutable
BEFORE UPDATE ON assessments
WHEN NEW.public_id IS NOT OLD.public_id
  OR NEW.initiative_id IS NOT OLD.initiative_id
  OR NEW.launch_token IS NOT OLD.launch_token
  OR NEW.detector_release IS NOT OLD.detector_release
  OR NEW.configuration IS NOT OLD.configuration
  OR NEW.configuration_digest IS NOT OLD.configuration_digest
  OR NEW.profile_schema_version IS NOT OLD.profile_schema_version
  OR NEW.relationship_schema_version IS NOT OLD.relationship_schema_version
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'assessments: recorded inputs cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER assessments_never_deleted
BEFORE DELETE ON assessments
BEGIN
  SELECT RAISE(ABORT, 'assessments: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- The scope is written with the assessment, in the same transaction and with
-- the same timestamp, and never grows afterward.
CREATE TRIGGER assessment_targets_created_with_assessment
BEFORE INSERT ON assessment_targets
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) IS NOT 'queued'
  OR NEW.created_at IS NOT (SELECT created_at FROM assessments WHERE id = NEW.assessment_id)
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope is frozen when the assessment is created');
END;
--> statement-breakpoint
-- Copied source configuration never changes, whatever happens in the catalog.
CREATE TRIGGER assessment_targets_scope_immutable
BEFORE UPDATE ON assessment_targets
WHEN NEW.public_id IS NOT OLD.public_id
  OR NEW.assessment_id IS NOT OLD.assessment_id
  OR NEW.repository_source_id IS NOT OLD.repository_source_id
  OR NEW.position IS NOT OLD.position
  OR NEW.source_public_id IS NOT OLD.source_public_id
  OR NEW.source_name IS NOT OLD.source_name
  OR NEW.clone_url IS NOT OLD.clone_url
  OR NEW.canonical_url IS NOT OLD.canonical_url
  OR NEW.git_ref IS NOT OLD.git_ref
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: the scope snapshot cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER assessment_targets_never_deleted
BEFORE DELETE ON assessment_targets
BEGIN
  SELECT RAISE(ABORT, 'assessment_targets: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A snapshot is recorded once, for its own target's source, while that target
-- is acquiring, and never changes.
CREATE TRIGGER source_snapshots_match_target
BEFORE INSERT ON source_snapshots
WHEN NEW.repository_source_id IS NOT (SELECT repository_source_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
  OR (SELECT state FROM assessment_targets WHERE id = NEW.assessment_target_id) IS NOT 'acquiring'
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: a snapshot is recorded for its acquiring target');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_immutable
BEFORE UPDATE ON source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_never_deleted
BEFORE DELETE ON source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_snapshots: results are retained and cannot be deleted');
END;
