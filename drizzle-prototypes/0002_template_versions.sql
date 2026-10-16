CREATE TABLE "prototypes"."template_rechecks" (
	"id" text PRIMARY KEY NOT NULL,
	"template_version_id" text NOT NULL,
	"runtime_hash" text NOT NULL,
	"salt_release" text NOT NULL,
	"status" text,
	"gates" jsonb,
	"compiled" text,
	"error" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prototypes"."template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"number" integer NOT NULL,
	"workspace_id" text,
	"accepted_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"brand" text NOT NULL,
	"tags" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"shell" jsonb NOT NULL,
	"preview_png" "bytea",
	"reproducibility" jsonb NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prototypes"."templates" ADD COLUMN "latest_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prototypes"."templates" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "prototypes"."template_rechecks" ADD CONSTRAINT "template_rechecks_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "prototypes"."template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "prototypes"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_rechecks_runtime" ON "prototypes"."template_rechecks" USING btree ("template_version_id","runtime_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_number" ON "prototypes"."template_versions" USING btree ("template_id","number");--> statement-breakpoint
-- Templates accepted before template versions existed become template version 1, with what they recorded. Only the latest copy was kept, so earlier acceptances aren't recoverable.
INSERT INTO "prototypes"."template_versions" ("id", "template_id", "number", "workspace_id", "accepted_by", "title", "description", "brand", "tags", "snapshot", "shell", "preview_png", "reproducibility", "accepted_at")
SELECT
	'ptv_' || substr(md5("id"), 1, 16), "id", 1, "workspace_id", "accepted_by", "title", "description", "brand", "tags",
	"snapshot" || jsonb_build_object('sampleData', coalesce("snapshot"->'sampleData', 'null'::jsonb)),
	"shell", "preview_png",
	jsonb_build_object(
		'saltRelease', coalesce("snapshot"->'provenance'->>'saltRelease', ''),
		'registryRelease', coalesce("snapshot"->'provenance'->>'registryRelease', ''),
		'kitVersion', coalesce("snapshot"->'provenance'->>'kitVersion', ''),
		'checksVersion', 1,
		'checkDigest', encode(sha256(convert_to(coalesce("snapshot"->'gates', '[]'::jsonb)::text, 'UTF8')), 'hex')
	),
	"accepted_at"
FROM "prototypes"."templates";--> statement-breakpoint
UPDATE "prototypes"."templates" SET "latest_number" = 1, "created_at" = "accepted_at";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "accepted_by";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "brand";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "snapshot";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "shell";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "preview_png";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "history";--> statement-breakpoint
ALTER TABLE "prototypes"."templates" DROP COLUMN "accepted_at";