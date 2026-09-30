-- Evaluation input and Finding invariants. The data-access layer enforces the
-- same rules; these triggers hold even for direct SQL.

CREATE TRIGGER evaluations_inputs_immutable
BEFORE UPDATE ON evaluations
WHEN NEW.public_id IS NOT OLD.public_id
  OR NEW.initiative_id IS NOT OLD.initiative_id
  OR NEW.assessment_id IS NOT OLD.assessment_id
  OR NEW.launch_token IS NOT OLD.launch_token
  OR NEW.evaluator_version IS NOT OLD.evaluator_version
  OR NEW.configuration IS NOT OLD.configuration
  OR NEW.configuration_digest IS NOT OLD.configuration_digest
  OR NEW.profile_schema_version IS NOT OLD.profile_schema_version
  OR NEW.relationship_schema_version IS NOT OLD.relationship_schema_version
  OR NEW.coverage_gaps IS NOT OLD.coverage_gaps
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'evaluations: pinned inputs cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER evaluations_never_deleted
BEFORE DELETE ON evaluations
BEGIN
  SELECT RAISE(ABORT, 'evaluations: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Releases are pinned with the Evaluation, by the published digest.
CREATE TRIGGER evaluation_releases_pinned_at_start
BEFORE INSERT ON evaluation_releases
WHEN (SELECT state FROM evaluations WHERE id = NEW.evaluation_id) IS NOT 'queued'
  OR NEW.created_at IS NOT (SELECT created_at FROM evaluations WHERE id = NEW.evaluation_id)
BEGIN
  SELECT RAISE(ABORT, 'evaluation_releases: Releases are pinned when the Evaluation is created');
END;
--> statement-breakpoint
CREATE TRIGGER evaluation_releases_digest_matches
BEFORE INSERT ON evaluation_releases
WHEN NEW.release_digest IS NOT (SELECT digest FROM standard_releases WHERE id = NEW.standard_release_id)
BEGIN
  SELECT RAISE(ABORT, 'evaluation_releases: the pinned digest must match the published Release');
END;
--> statement-breakpoint
CREATE TRIGGER evaluation_releases_pins_immutable
BEFORE UPDATE ON evaluation_releases
WHEN NEW.evaluation_id IS NOT OLD.evaluation_id
  OR NEW.standard_release_id IS NOT OLD.standard_release_id
  OR NEW.release_digest IS NOT OLD.release_digest
  OR NEW.position IS NOT OLD.position
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'evaluation_releases: pinned inputs cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER evaluation_releases_never_deleted
BEFORE DELETE ON evaluation_releases
BEGIN
  SELECT RAISE(ABORT, 'evaluation_releases: results are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A Finding belongs to its pinned Release and is written only while that
-- Release is being evaluated.
CREATE TRIGGER findings_written_while_evaluating
BEFORE INSERT ON findings
WHEN (SELECT state FROM evaluations WHERE id = NEW.evaluation_id) IS NOT 'evaluating'
  OR (SELECT state FROM evaluation_releases WHERE id = NEW.evaluation_release_id) IS NOT 'evaluating'
BEGIN
  SELECT RAISE(ABORT, 'findings: Findings cannot be added after the Evaluation is finalized');
END;
--> statement-breakpoint
CREATE TRIGGER findings_match_pinned_release
BEFORE INSERT ON findings
WHEN NEW.evaluation_id IS NOT (SELECT evaluation_id FROM evaluation_releases WHERE id = NEW.evaluation_release_id)
  OR NEW.standard_release_id IS NOT (SELECT standard_release_id FROM evaluation_releases WHERE id = NEW.evaluation_release_id)
  OR (NEW.assessment_target_id IS NOT NULL AND (SELECT assessment_id FROM assessment_targets WHERE id = NEW.assessment_target_id)
      IS NOT (SELECT assessment_id FROM evaluations WHERE id = NEW.evaluation_id))
BEGIN
  SELECT RAISE(ABORT, 'findings: a Finding must match its pinned Release and Assessment');
END;
--> statement-breakpoint
CREATE TRIGGER findings_immutable
BEFORE UPDATE ON findings
BEGIN
  SELECT RAISE(ABORT, 'findings: Findings are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER findings_never_deleted
BEFORE DELETE ON findings
BEGIN
  SELECT RAISE(ABORT, 'findings: results are retained and cannot be deleted');
END;
