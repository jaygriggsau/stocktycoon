ALTER TABLE "companies" ADD COLUMN "analyst_rating" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "price_target" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "rated_day" integer DEFAULT 0 NOT NULL;