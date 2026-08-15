import { NextResponse } from "next/server";
import { advanceMarket } from "@/lib/sim/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Optional cron endpoint (see vercel.json). The market also advances lazily
 * on page loads, so this only keeps the simulation warm during quiet hours.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }
  const day = await advanceMarket();
  return NextResponse.json({ ok: true, marketDay: day });
}
