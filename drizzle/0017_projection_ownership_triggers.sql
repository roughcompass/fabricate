-- The assessment projection is derived from immutable Profile and
-- Relationship Map documents. Its rows are written once, in the document's own
-- transaction, and removed only by a rebuild, which recreates them from the
-- documents. A rebuild marks itself in projection_state.
INSERT INTO projection_state (id, rebuilding) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER dependency_facts_immutable
BEFORE UPDATE ON dependency_facts
BEGIN
  SELECT RAISE(ABORT, 'dependency_facts: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER dependency_facts_removed_by_rebuild
BEFORE DELETE ON dependency_facts
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'dependency_facts: projection rows are removed only by a rebuild');
END;
--> statement-breakpoint
CREATE TRIGGER graph_nodes_immutable
BEFORE UPDATE ON graph_nodes
BEGIN
  SELECT RAISE(ABORT, 'graph_nodes: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER graph_nodes_removed_by_rebuild
BEFORE DELETE ON graph_nodes
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'graph_nodes: projection rows are removed only by a rebuild');
END;
--> statement-breakpoint
CREATE TRIGGER graph_edges_immutable
BEFORE UPDATE ON graph_edges
BEGIN
  SELECT RAISE(ABORT, 'graph_edges: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER graph_edges_removed_by_rebuild
BEFORE DELETE ON graph_edges
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'graph_edges: projection rows are removed only by a rebuild');
END;
--> statement-breakpoint
CREATE TRIGGER evidence_index_immutable
BEFORE UPDATE ON evidence_index
BEGIN
  SELECT RAISE(ABORT, 'evidence_index: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER evidence_index_removed_by_rebuild
BEFORE DELETE ON evidence_index
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'evidence_index: projection rows are removed only by a rebuild');
END;
--> statement-breakpoint
CREATE TRIGGER concept_classifications_immutable
BEFORE UPDATE ON concept_classifications
BEGIN
  SELECT RAISE(ABORT, 'concept_classifications: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER concept_classifications_removed_by_rebuild
BEFORE DELETE ON concept_classifications
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'concept_classifications: projection rows are removed only by a rebuild');
END;
--> statement-breakpoint
CREATE TRIGGER projection_coverage_immutable
BEFORE UPDATE ON projection_coverage
BEGIN
  SELECT RAISE(ABORT, 'projection_coverage: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER projection_coverage_removed_by_rebuild
BEFORE DELETE ON projection_coverage
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'projection_coverage: projection rows are removed only by a rebuild');
END;
--> statement-breakpoint
CREATE TRIGGER projection_state_kept
BEFORE DELETE ON projection_state
BEGIN
  SELECT RAISE(ABORT, 'projection_state: the rebuild marker is kept');
END;
--> statement-breakpoint
-- Ontology releases and their concepts are imported once and kept forever.
CREATE TRIGGER ontology_releases_immutable
BEFORE UPDATE ON ontology_releases
BEGIN
  SELECT RAISE(ABORT, 'ontology_releases: an imported release never changes');
END;
--> statement-breakpoint
CREATE TRIGGER ontology_releases_never_deleted
BEFORE DELETE ON ontology_releases
BEGIN
  SELECT RAISE(ABORT, 'ontology_releases: releases are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER ontology_concepts_immutable
BEFORE UPDATE ON ontology_concepts
BEGIN
  SELECT RAISE(ABORT, 'ontology_concepts: an imported release never changes');
END;
--> statement-breakpoint
CREATE TRIGGER ontology_concepts_never_deleted
BEFORE DELETE ON ontology_concepts
BEGIN
  SELECT RAISE(ABORT, 'ontology_concepts: releases are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Ownership assertions are an append-only history.
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
-- An assertion supersedes only an earlier assertion about the same subject and attribute.
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
-- Applications, portals, and Lines of Business keep their identity. A portal
-- or Line of Business gains its concept once, when a release approves it.
CREATE TRIGGER seal_applications_identity
BEFORE UPDATE ON seal_applications
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.seal_id IS NOT OLD.seal_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'seal_applications: an application keeps its public ID and SEAL ID');
END;
--> statement-breakpoint
CREATE TRIGGER portals_identity
BEFORE UPDATE ON portals
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.label IS NOT OLD.label OR NEW.label_key IS NOT OLD.label_key OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.concept_key IS NOT NULL AND NEW.concept_key IS NOT OLD.concept_key)
BEGIN
  SELECT RAISE(ABORT, 'portals: a portal keeps its identity, and its concept once approved');
END;
--> statement-breakpoint
CREATE TRIGGER lines_of_business_identity
BEFORE UPDATE ON lines_of_business
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.label IS NOT OLD.label OR NEW.label_key IS NOT OLD.label_key OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.concept_key IS NOT NULL AND NEW.concept_key IS NOT OLD.concept_key)
BEGIN
  SELECT RAISE(ABORT, 'lines_of_business: a Line of Business keeps its identity, and its concept once approved');
END;
--> statement-breakpoint
CREATE TRIGGER seal_applications_never_deleted
BEFORE DELETE ON seal_applications
BEGIN
  SELECT RAISE(ABORT, 'seal_applications: ownership records are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER portals_never_deleted
BEFORE DELETE ON portals
BEGIN
  SELECT RAISE(ABORT, 'portals: ownership records are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER lines_of_business_never_deleted
BEFORE DELETE ON lines_of_business
BEGIN
  SELECT RAISE(ABORT, 'lines_of_business: ownership records are retained and cannot be deleted');
END;
