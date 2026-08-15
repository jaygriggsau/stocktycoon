CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"sector_id" integer NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"listed_day" integer DEFAULT 0 NOT NULL,
	"delisted_day" integer,
	"price" double precision NOT NULL,
	"prev_close" double precision NOT NULL,
	"shares_outstanding" bigint NOT NULL,
	"revenue" double precision NOT NULL,
	"earnings" double precision NOT NULL,
	"cash_reserves" double precision NOT NULL,
	"growth_rate" double precision NOT NULL,
	"profit_margin" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"beta" double precision NOT NULL,
	"quality" double precision NOT NULL,
	"dividend_yield" double precision DEFAULT 0 NOT NULL,
	"earnings_offset" integer DEFAULT 0 NOT NULL,
	"distress_days" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"user_id" text NOT NULL,
	"company_id" integer NOT NULL,
	"shares" bigint NOT NULL,
	"avg_cost" double precision NOT NULL,
	CONSTRAINT "holdings_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "index_bars" (
	"index_key" text NOT NULL,
	"day" integer NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "index_bars_index_key_day_pk" PRIMARY KEY("index_key","day")
);
--> statement-breakpoint
CREATE TABLE "market_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"market_day" integer DEFAULT 0 NOT NULL,
	"epoch_ms" bigint NOT NULL,
	"regime_drift" double precision DEFAULT 0.0002 NOT NULL,
	"regime_label" text DEFAULT 'neutral' NOT NULL,
	"interest_rate" double precision DEFAULT 0.04 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" integer NOT NULL,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"body" text,
	"company_id" integer,
	"sector_id" integer,
	"price_impact" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" integer NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"shares" bigint NOT NULL,
	"limit_price" double precision,
	"fill_price" double precision,
	"placed_day" integer NOT NULL,
	"filled_day" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"cash" double precision DEFAULT 100000 NOT NULL,
	"starting_cash" double precision DEFAULT 100000 NOT NULL,
	"realized_pnl" double precision DEFAULT 0 NOT NULL,
	"total_dividends" double precision DEFAULT 0 NOT NULL,
	"created_day" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"user_id" text NOT NULL,
	"day" integer NOT NULL,
	"net_worth" double precision NOT NULL,
	"cash" double precision NOT NULL,
	CONSTRAINT "portfolio_snapshots_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "price_bars" (
	"company_id" integer NOT NULL,
	"day" integer NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" bigint NOT NULL,
	CONSTRAINT "price_bars_company_id_day_pk" PRIMARY KEY("company_id","day")
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"momentum" double precision DEFAULT 0 NOT NULL,
	"base_volatility" double precision DEFAULT 0.02 NOT NULL,
	"base_growth" double precision DEFAULT 0.05 NOT NULL,
	CONSTRAINT "sectors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" integer NOT NULL,
	"side" text NOT NULL,
	"shares" bigint NOT NULL,
	"price" double precision NOT NULL,
	"realized_pnl" double precision,
	"day" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_symbol_idx" ON "companies" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "companies_sector_idx" ON "companies" USING btree ("sector_id");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "holdings_company_idx" ON "holdings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "news_day_idx" ON "news_items" USING btree ("day");--> statement-breakpoint
CREATE INDEX "news_company_idx" ON "news_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "price_bars_day_idx" ON "price_bars" USING btree ("day");--> statement-breakpoint
CREATE INDEX "trades_user_idx" ON "trades" USING btree ("user_id");