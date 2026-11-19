-- Columns nothing reads (prune-and-consolidate-code, task 4.3): the Releases
-- a Salt Patterns re-check pinned to its Run, a repository node's commit,
-- which its Profile records, and an evidence record's content digest, which
-- its Profile's document keeps. None is named by a CHECK or an index, so each
-- goes in place; the one trigger that guards a column goes first.
DROP TRIGGER assessments_evaluation_releases_fixed;--> statement-breakpoint
ALTER TABLE `assessments` DROP COLUMN `evaluation_releases`;--> statement-breakpoint
ALTER TABLE `evidence_index` DROP COLUMN `content_digest`;--> statement-breakpoint
ALTER TABLE `graph_nodes` DROP COLUMN `commit_sha`;
