CREATE TABLE `bitbucket_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`server_url` text NOT NULL,
	`token` text NOT NULL,
	`token_hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "bitbucket_tokens_public_id" CHECK("bitbucket_tokens"."public_id" GLOB 'bbt_*'),
	CONSTRAINT "bitbucket_tokens_name" CHECK(length(trim("bitbucket_tokens"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "bitbucket_tokens_server_url" CHECK("bitbucket_tokens"."server_url" GLOB 'http*://*'),
	CONSTRAINT "bitbucket_tokens_token" CHECK(length("bitbucket_tokens"."token") BETWEEN 8 AND 4096),
	CONSTRAINT "bitbucket_tokens_token_hint" CHECK(length("bitbucket_tokens"."token_hint") = 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bitbucket_tokens_public_id_unique` ON `bitbucket_tokens` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bitbucket_tokens_server_name` ON `bitbucket_tokens` (`server_url`,`name`);