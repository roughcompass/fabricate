-- A server has one saved Bitbucket token, whoever owns it
-- (use-saved-git-tokens, design decision 1): Git sends the token saved for a
-- remote's server, so two tokens for one server would leave it no clear
-- choice. The unique index moves from the server and owner to the server.
--
-- A database may already hold several tokens for one server, saved for
-- different owners. The newest stays, the one saved last, and on a tie the
-- one with the larger id; the others are deleted, so the unique index can be
-- created and the upgrade doesn't stop on it. `npm run db:migrate` (and
-- `node dist/migrate.cjs`) lists each deleted token by its owner, server,
-- and last four characters, so the operator can save it again over the kept
-- one or revoke it in Bitbucket. Server addresses were always stored
-- normalized, so tokens for one server already share the same text.
DELETE FROM `bitbucket_tokens`
WHERE EXISTS (
	SELECT 1
	FROM `bitbucket_tokens` AS `newer`
	WHERE `newer`.`server_url` = `bitbucket_tokens`.`server_url`
		AND (`newer`.`created_at` > `bitbucket_tokens`.`created_at` OR (`newer`.`created_at` = `bitbucket_tokens`.`created_at` AND `newer`.`id` > `bitbucket_tokens`.`id`))
);
--> statement-breakpoint
DROP INDEX `bitbucket_tokens_server_name`;--> statement-breakpoint
CREATE UNIQUE INDEX `bitbucket_tokens_server_url_unique` ON `bitbucket_tokens` (`server_url`);
