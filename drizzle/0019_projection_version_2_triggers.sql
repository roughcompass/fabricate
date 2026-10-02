-- Projection version 2 adds each edge's reference and review kind, and the
-- candidates of ambiguous edges. Rows of version 1 keep nulls until a rebuild
-- recreates them; every row of version 2 or later must be complete.
CREATE TRIGGER graph_edges_version_2_complete
BEFORE INSERT ON graph_edges
WHEN NEW.projection_version >= 2
  AND (NEW.reference_type IS NULL
    OR NEW.reference_identifier IS NULL
    OR NOT json_valid(NEW.reference_identifier)
    OR json_type(NEW.reference_identifier) IS NOT 'object'
    OR NEW.kind IS NULL
    OR NEW.kind NOT IN ('third_party', 'own_package', 'self', 'architecture'))
BEGIN
  SELECT RAISE(ABORT, 'graph_edges: an edge of projection version 2 records its reference and kind');
END;
--> statement-breakpoint
CREATE TRIGGER graph_edge_candidates_immutable
BEFORE UPDATE ON graph_edge_candidates
BEGIN
  SELECT RAISE(ABORT, 'graph_edge_candidates: projection rows are written once');
END;
--> statement-breakpoint
CREATE TRIGGER graph_edge_candidates_removed_by_rebuild
BEFORE DELETE ON graph_edge_candidates
WHEN (SELECT rebuilding FROM projection_state WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'graph_edge_candidates: projection rows are removed only by a rebuild');
END;
