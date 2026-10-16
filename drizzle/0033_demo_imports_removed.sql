-- Demo deployments imported from the demo's BitBucket go, with their comment
-- threads, comments, and share links: Import from BitBucket is removed
-- (make-applications-first-class design decision 11). migrateDatabase turns
-- foreign key enforcement off for the run, so the cascades are spelled out.
DELETE FROM demo_comments WHERE thread_id IN (SELECT t.id FROM demo_threads t JOIN demo_applications a ON a.id = t.application_id WHERE a.origin = 'import');--> statement-breakpoint
DELETE FROM demo_threads WHERE application_id IN (SELECT id FROM demo_applications WHERE origin = 'import');--> statement-breakpoint
DELETE FROM demo_shares WHERE application_id IN (SELECT id FROM demo_applications WHERE origin = 'import');--> statement-breakpoint
DELETE FROM demo_applications WHERE origin = 'import';
