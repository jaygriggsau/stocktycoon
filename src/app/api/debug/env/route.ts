import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Reports which env vars are visible to the runtime (presence only, no values). */
export async function GET() {
  const present = (v: string | undefined) => (v === undefined ? "missing" : v.trim() === "" ? "empty" : "set");
  return NextResponse.json({
    DATABASE_URL: present(process.env.DATABASE_URL),
    NEON_AUTH_BASE_URL: present(process.env.NEON_AUTH_BASE_URL),
    NEON_AUTH_COOKIE_SECRET: present(process.env.NEON_AUTH_COOKIE_SECRET),
    CRON_SECRET: present(process.env.CRON_SECRET),
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}
