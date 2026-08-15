import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Fall back to a placeholder so `next build` succeeds without env vars;
// real queries fail loudly at runtime until DATABASE_URL is configured.
const connectionString =
  process.env.DATABASE_URL?.trim() || "postgresql://missing:missing@missing-database-url.invalid/neondb";

export const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
export { schema };
