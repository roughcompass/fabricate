-- One worker process runs per database (prune-and-consolidate-code, design
-- decision 11): it refuses to start while another holds the worker.lock file
-- beside the database, and serializes updates to each repository's local copy
-- in its own memory. Leases across processes go.
DROP TABLE `source_leases`;
